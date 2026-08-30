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
  if (typeof window.todayStr === "undefined") window.todayStr = todayStr;
  if (typeof window.dataUrlToBlob === "undefined") window.dataUrlToBlob = dataUrlToBlob;
  if (typeof window.sanitizeForPath === "undefined") window.sanitizeForPath = sanitizeForPath;
  window.loadExcelJS = loadExcelJS;
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1hZHZhbmNlZC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXHJcbi8qKlxyXG4gKiBDU1Ygc2VyaWFsaXplciArIGRhdGFzZXQgc2NoZW1hcyArIHJvdyBidWlsZGVycyBcdTIwMTQgcGFyYSBleHBvcnREYXRhc2V0WmlwXHJcbiAqICh2MzcxKykuIEZ1bmNpb25lcyBwdXJhcywgdGVzdGVhYmxlcyBzaW4gZ2xvYmFscyBkZWwgYnVuZGxlLlxyXG4gKlxyXG4gKiA1IGNhc29zIGRlIHVzbyBNTCBkb2N1bWVudGFkb3MgZW4gREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVg6XHJcbiAqICAgQSkgQ29udmVyc2lvbiB2aXNpdGEtPnBlZGlkbyAocHJpb3JpZGFkIDEsIGNsYXNpZmljYWNpb24pXHJcbiAqICAgQikgUmllc2dvIGRlIGNodXJuIGRlIGNsaWVudGVzIChwcmlvcmlkYWQgMiwgYWxlcnRhKVxyXG4gKiAgIEMpIEZvcmVjYXN0IGRlIGRlbWFuZGEgcG9yIFNLVSAocHJpb3JpZGFkIDMsIHNlcmllcyB0ZW1wb3JhbGVzKVxyXG4gKiAgIEQpIEFub21hbGlhcyBlbiByZW5kaWNpb25lcyAoZXhwbG9yYXRvcmlvKVxyXG4gKiAgIEUpIEVzdGFjaW9uYWxpZGFkIHBvciB6b25hL2NhbXBhbmEgKGV4cGxvcmF0b3JpbylcclxuICpcclxuICogQ29udmVuY2lvbmVzIChSRkMgNDE4MCArIGFkYXB0YWNpb25lcyBwYXJhIE1MIHBpcGVsaW5lcyk6XHJcbiAqICAgLSBTZXBhcmF0b3I6IFwiLFwiXHJcbiAqICAgLSBRdW90ZSBjaGFyOiBcIlxcXCJcIlxyXG4gKiAgIC0gRXNjYXBlIHF1b3RlOiBcIlxcXCJcXFwiXCJcclxuICogICAtIExpbmUgdGVybWluYXRvcjogXCJcXHJcXG5cIlxyXG4gKiAgIC0gRW5jb2Rpbmc6IFVURi04IChCT00gb3BjaW9uYWwgYWwgZXNjcmliaXIgZWwgWklQKVxyXG4gKiAgIC0gRmVjaGFzOiBJU08gODYwMSBVVEMgKGNvbiBcIlpcIiBhbCBmaW5hbClcclxuICogICAtIERlY2ltYWxlczogcHVudG8gKFwiLlwiKVxyXG4gKiAgIC0gTnVsbC91bmRlZmluZWQ6IGNhbXBvIHZhY2lvIChOTyBcIk4vQVwiLCBcIi1cIiwgXCJudWxsXCIpXHJcbiAqICAgLSBBcnJheXMgLT4gSlNPTi5zdHJpbmdpZnkgZW50cmUgY29taWxsYXMgZG9ibGVzXHJcbiAqICAgLSBPYmpldG9zIChleGNlcHRvIFRpbWVzdGFtcCB5IERhdGUpIC0+IEpTT04uc3RyaW5naWZ5XHJcbiAqICAgLSBGaXJlc3RvcmUgVGltZXN0YW1wcyAtPiB0b0RhdGUoKS50b0lTT1N0cmluZygpXHJcbiAqL1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEhlbHBlcnMgQ1NWIHB1cm9zXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuLyoqXHJcbiAqIEVzY2FwYSB1biB2YWxvciBzdHJpbmcgcGFyYSBDU1YgUkZDIDQxODAuIFdyYXBwZWEgY29uIFwiLi4uXCIgc2kgY29udGllbmVcclxuICogXCIsXCIsIFwiXFxcIlwiLCBcIlxcclwiIG8gXCJcXG5cIi4gRXNjYXBhIFwiXFxcIlwiIC0+IFwiXFxcIlxcXCJcIi5cclxuICogQHBhcmFtIHtzdHJpbmd9IHNcclxuICogQHJldHVybnMge3N0cmluZ31cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBjc3ZFc2NhcGUocykge1xyXG4gIGlmIChzID09PSBudWxsIHx8IHMgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xyXG4gIGNvbnN0IHN0ciA9IFN0cmluZyhzKTtcclxuICBpZiAoc3RyID09PSAnJykgcmV0dXJuICcnO1xyXG4gIC8vIE5lY2VzaXRhIHF1b3Rpbmcgc2kgdGllbmUgY29tYSwgcXVvdGUsIG8gbGluZS1icmVha1xyXG4gIGlmICgvW1wiLFxcclxcbl0vLnRlc3Qoc3RyKSkge1xyXG4gICAgcmV0dXJuICdcIicgKyBzdHIucmVwbGFjZSgvXCIvZywgJ1wiXCInKSArICdcIic7XHJcbiAgfVxyXG4gIHJldHVybiBzdHI7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDb252aWVydGUgdW4gYXJyYXkgZGUgdmFsb3JlcyBlbiB1bmEgbGluZWEgQ1NWIChzaW4gdHJhaWxpbmcgbmV3bGluZSkuXHJcbiAqIEFwbGljYSBjc3ZFc2NhcGUgYSBjYWRhIGNhbXBvIGRlc3B1ZXMgZGUgZmlyZXN0b3JlVmFsdWVUb0Nzdi5cclxuICogQHBhcmFtIHt1bmtub3duW119IGZpZWxkc1xyXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGNzdlJvdyhmaWVsZHMpIHtcclxuICByZXR1cm4gZmllbGRzLm1hcCgoZikgPT4gY3N2RXNjYXBlKGZpcmVzdG9yZVZhbHVlVG9Dc3YoZikpKS5qb2luKCcsJyk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDb252aWVydGUgdW4gdmFsb3IgZGUgRmlyZXN0b3JlL0pTIGEgc3RyaW5nIGFwdG8gcGFyYSBDU1YuXHJcbiAqIFJlZ2xhIHBvciB0aXBvOlxyXG4gKiAgIC0gbnVsbCAvIHVuZGVmaW5lZCAtPiAnJ1xyXG4gKiAgIC0gRmlyZXN0b3JlIFRpbWVzdGFtcCAodGllbmUgLnRvRGF0ZSkgLT4gSVNPIDg2MDEgVVRDXHJcbiAqICAgLSBEYXRlIC0+IElTTyA4NjAxIFVUQ1xyXG4gKiAgIC0gYm9vbGVhbiAtPiAndHJ1ZScgLyAnZmFsc2UnXHJcbiAqICAgLSBudW1iZXIgLT4gU3RyaW5nKG4pIGNvbiBwdW50byBkZWNpbWFsXHJcbiAqICAgLSBzdHJpbmcgLT4gdGFsIGN1YWwgKGNzdkVzY2FwZSB3cmFwcGVhIHNpIGhhY2UgZmFsdGEpXHJcbiAqICAgLSBBcnJheSAtPiBKU09OLnN0cmluZ2lmeVxyXG4gKiAgIC0gT2JqZWN0IC0+IEpTT04uc3RyaW5naWZ5XHJcbiAqIEBwYXJhbSB7dW5rbm93bn0gdlxyXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGZpcmVzdG9yZVZhbHVlVG9Dc3Yodikge1xyXG4gIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xyXG4gIGlmICh0eXBlb2YgdiA9PT0gJ3N0cmluZycpIHJldHVybiB2O1xyXG4gIGlmICh0eXBlb2YgdiA9PT0gJ251bWJlcicpIHtcclxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHYpKSByZXR1cm4gJyc7IC8vIE5hTiwgSW5maW5pdHkgLT4gdmFjaW8gKG5vIGNvbmZ1bmRpciBwaXBlbGluZXMpXHJcbiAgICByZXR1cm4gU3RyaW5nKHYpO1xyXG4gIH1cclxuICBpZiAodHlwZW9mIHYgPT09ICdib29sZWFuJykgcmV0dXJuIHYgPyAndHJ1ZScgOiAnZmFsc2UnO1xyXG4gIC8vIEZpcmVzdG9yZSBUaW1lc3RhbXBcclxuICBpZiAoXHJcbiAgICB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiZcclxuICAgIHYgIT09IG51bGwgJiZcclxuICAgIHR5cGVvZiAoLyoqIEB0eXBlIHthbnl9ICovICh2KS50b0RhdGUpID09PSAnZnVuY3Rpb24nXHJcbiAgKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHthbnl9ICovICh2KS50b0RhdGUoKS50b0lTT1N0cmluZygpO1xyXG4gICAgfSBjYXRjaCAoXykge1xyXG4gICAgICByZXR1cm4gJyc7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGlmICh2IGluc3RhbmNlb2YgRGF0ZSkge1xyXG4gICAgaWYgKE51bWJlci5pc05hTih2LmdldFRpbWUoKSkpIHJldHVybiAnJztcclxuICAgIHJldHVybiB2LnRvSVNPU3RyaW5nKCk7XHJcbiAgfVxyXG4gIGlmIChBcnJheS5pc0FycmF5KHYpKSB7XHJcbiAgICAvLyBKU09OLnN0cmluZ2lmeSBkZSBhcnJheS4gY3N2RXNjYXBlIGx1ZWdvIGxvIHdyYXBwZWEgc2kgaGF5IGNvbWFzLlxyXG4gICAgdHJ5IHtcclxuICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHYpO1xyXG4gICAgfSBjYXRjaCAoXykge1xyXG4gICAgICByZXR1cm4gJyc7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGlmICh0eXBlb2YgdiA9PT0gJ29iamVjdCcpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTtcclxuICAgIH0gY2F0Y2ggKF8pIHtcclxuICAgICAgcmV0dXJuICcnO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gU3RyaW5nKHYpO1xyXG59XHJcblxyXG4vKipcclxuICogT2J0aWVuZSBlbCB2YWxvciBkZSB1biBwYXRoIGRvdC1ub3RhdGlvbiBlbiB1biBvYmpldG8gYW5pZGFkby5cclxuICogRWo6IGdldFBhdGgoe2E6IHtiOiB7YzogMX19fSwgJ2EuYi5jJykgLT4gMVxyXG4gKiBnZXRQYXRoKHt9LCAnYS5iJykgLT4gdW5kZWZpbmVkXHJcbiAqIEBwYXJhbSB7b2JqZWN0fSBvYmpcclxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGhcclxuICogQHJldHVybnMge3Vua25vd259XHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gZ2V0UGF0aChvYmosIHBhdGgpIHtcclxuICBpZiAoIW9iaiB8fCAhcGF0aCkgcmV0dXJuIHVuZGVmaW5lZDtcclxuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy4nKTtcclxuICBsZXQgY3VyID0gLyoqIEB0eXBlIHthbnl9ICovIChvYmopO1xyXG4gIGZvciAoY29uc3QgcCBvZiBwYXJ0cykge1xyXG4gICAgaWYgKGN1ciA9PT0gbnVsbCB8fCBjdXIgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIGN1ciA9IGN1cltwXTtcclxuICB9XHJcbiAgcmV0dXJuIGN1cjtcclxufVxyXG5cclxuLyoqXHJcbiAqIENvbnN0cnV5ZSBlbCBDU1YgY29tcGxldG8gKGhlYWRlciArIE4gcm93cykgcGFyYSB1bmEgY29sZWNjaW9uIHNlZ3VuXHJcbiAqIHN1IHNjaGVtYS4gQ2FkYSBidWlsZGVyIGRldnVlbHZlIHVuIGFycmF5IGRlIGZpbGFzIChjYWRhIGZpbGEgPSBhcnJheVxyXG4gKiBkZSB2YWxvcmVzIGVuIGVsIG9yZGVuIGRlbCBzY2hlbWEpLlxyXG4gKiBAcGFyYW0ge3tjb2x1bW5zOiB7Y29sOiBzdHJpbmd9W119fSBzY2hlbWFcclxuICogQHBhcmFtIHt1bmtub3duW11bXX0gcm93c1xyXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBDU1YgY29tcGxldG8gY29uIFxcclxcbiBjb21vIGxpbmUgc2VwYXJhdG9yXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDc3Yoc2NoZW1hLCByb3dzKSB7XHJcbiAgY29uc3QgaGVhZGVyID0gc2NoZW1hLmNvbHVtbnMubWFwKChjKSA9PiBjc3ZFc2NhcGUoYy5jb2wpKS5qb2luKCcsJyk7XHJcbiAgY29uc3QgYm9keSA9IHJvd3MubWFwKChyKSA9PiBjc3ZSb3cocikpLmpvaW4oJ1xcclxcbicpO1xyXG4gIHJldHVybiBib2R5Lmxlbmd0aCA/IGhlYWRlciArICdcXHJcXG4nICsgYm9keSArICdcXHJcXG4nIDogaGVhZGVyICsgJ1xcclxcbic7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDdWVudGEgbnVsbCByYXRlIHBvciBjb2x1bW5hIHJlcXVlcmlkYS4gUmV0b3JuYVxyXG4gKiB7Y29sTmFtZTogcmF0ZSAwLi4xfS4gVW4gdmFsb3IgZXMgXCJudWxsXCIgc2kgZmlyZXN0b3JlVmFsdWVUb0NzdiBkZXZ1ZWx2ZSAnJy5cclxuICogQHBhcmFtIHt7Y29sdW1uczoge2NvbDogc3RyaW5nfVtdfX0gc2NoZW1hXHJcbiAqIEBwYXJhbSB7dW5rbm93bltdW119IHJvd3NcclxuICogQHBhcmFtIHtzdHJpbmdbXX0gcmVxdWlyZWRDb2xzXHJcbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVOdWxsUmF0ZXMoc2NoZW1hLCByb3dzLCByZXF1aXJlZENvbHMpIHtcclxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXHJcbiAgY29uc3QgcmVzdWx0ID0ge307XHJcbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xyXG4gICAgLy8gc2luIGRhdG9zOiBudWxsIHJhdGUgPSAxICgxMDAlIGZhbHRhKSBwYXJhIGNhZGEgY2FtcG8gcmVxdWVyaWRvXHJcbiAgICBmb3IgKGNvbnN0IGMgb2YgcmVxdWlyZWRDb2xzKSByZXN1bHRbY10gPSAxO1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcbiAgY29uc3QgY29sSW5kZXggPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSk7XHJcbiAgc2NoZW1hLmNvbHVtbnMuZm9yRWFjaCgoYywgaSkgPT4ge1xyXG4gICAgY29sSW5kZXhbYy5jb2xdID0gaTtcclxuICB9KTtcclxuICBmb3IgKGNvbnN0IHJjIG9mIHJlcXVpcmVkQ29scykge1xyXG4gICAgY29uc3QgaWR4ID0gY29sSW5kZXhbcmNdO1xyXG4gICAgaWYgKGlkeCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHJlc3VsdFtyY10gPSAxOyAvLyBjb2x1bW5hIG5vIGV4aXN0ZSBlbiBzY2hlbWEgLT4gY29uc2lkZXJhciBjb21vIDEwMCUgbnVsbFxyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGxldCBudWxscyA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XHJcbiAgICAgIGNvbnN0IHYgPSByb3dbaWR4XTtcclxuICAgICAgaWYgKGZpcmVzdG9yZVZhbHVlVG9Dc3YodikgPT09ICcnKSBudWxscysrO1xyXG4gICAgfVxyXG4gICAgcmVzdWx0W3JjXSA9IE1hdGgucm91bmQoKG51bGxzIC8gcm93cy5sZW5ndGgpICogMTAwMDApIC8gMTAwMDA7XHJcbiAgfVxyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBEQVRBU0VUX1NDSEVNQVMgXHUyMDE0IDExIGNvbGVjY2lvbmVzIGNvbiBjb2x1bW5hcyArIHRpcG9zICsgZGVzY3JpcGNpb25lc1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8qKiBAdHlwZWRlZiB7e2NvbDogc3RyaW5nLCB0eXBlOiBzdHJpbmcsIGRlc2M6IHN0cmluZ319IFNjaGVtYUNvbHVtbiAqL1xyXG4vKiogQHR5cGVkZWYge3tuYW1lOiBzdHJpbmcsIHNvdXJjZTogJ2ZpcmVzdG9yZSd8J3N0b2NrX2pzb24nLCBjb2xsZWN0aW9uPzogc3RyaW5nLCByb3dNb2RlOiBzdHJpbmcsIGNvbHVtbnM6IFNjaGVtYUNvbHVtbltdfX0gRGF0YXNldFNjaGVtYSAqL1xyXG5cclxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBEYXRhc2V0U2NoZW1hPn0gKi9cclxuZXhwb3J0IGNvbnN0IERBVEFTRVRfU0NIRU1BUyA9IHtcclxuICBwZWRpZG9zOiB7XHJcbiAgICBuYW1lOiAncGVkaWRvcy5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICdwZWRpZG9zJyxcclxuICAgIHJvd01vZGU6ICdmbGF0dGVuX2xpbmVzJywgLy8gMSBmaWxhIHBvciAocGVkaWRvLCBsaW5lYSlcclxuICAgIGNvbHVtbnM6IFtcclxuICAgICAgeyBjb2w6ICdwZWRpZG9faWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXHJcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGVsIHZlbmRlZG9yIGR1ZW5pbyBkZWwgcGVkaWRvJyB9LFxyXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlbWFpbCBkZWwgdmVuZGVkb3InIH0sXHJcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9ieV91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3F1aWVuIGNhcmdvIChWREkgcHVlZGUgY2FyZ2FyIHBvciBWREUpJyB9LFxyXG4gICAgICB7IGNvbDogJ29uX2JlaGFsZl9vZicsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWUgc2kgVkRJIGNhcmdvIHBvciBWREUnIH0sXHJcbiAgICAgIHsgY29sOiAna2V5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdjbGF2ZSBjb21wdWVzdGEgdGlwb3xwcm92fGxvY3xjbGllbnRlJyB9LFxyXG4gICAgICB7IGNvbDogJ3N0YWdlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwZW5kaW5nIHwgY29uZmlybWVkIHwgc2FwX2ltcG9ydGVkJyB9LFxyXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0M9Y2xpZW50ZSB8IFA9cHJvc3BlY3RvJyB9LFxyXG4gICAgICB7IGNvbDogJ3Byb3ZpbmNlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwcm92aW5jaWEnIH0sXHJcbiAgICAgIHsgY29sOiAnbG9jX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2xvY2FsaWRhZCcgfSxcclxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNsaWVudGUnIH0sXHJcbiAgICAgIHsgY29sOiAnbW9udGgnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFwiSnVsaW8gMjAyNlwiJyB9LFxyXG4gICAgICB7IGNvbDogJ21vbnRoX2lkeCcsIHR5cGU6ICdpbnQnLCBkZXNjOiAnMC0xMScgfSxcclxuICAgICAgeyBjb2w6ICd5ZWFyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdhbm8nIH0sXHJcbiAgICAgIHsgY29sOiAnY29uZmlybWVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQyBkZSBjb25maXJtYWNpb24nIH0sXHJcbiAgICAgIHsgY29sOiAnY29uZGljaW9uX3BhZ28nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIENUQSBDVEUnIH0sXHJcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdUUkFOU1BPUlRJU1RBIHwgU1VDVVJTQUwnIH0sXHJcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV90cmFuc3Bfbm9tYnJlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV90cmFuc3BfZGlyZWNjaW9uJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9jbGllbnRlX2RpcmVjY2lvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGVzdGlubyBmaW5hbCcgfSxcclxuICAgICAgeyBjb2w6ICdmb3JtYV9lbnRyZWdhX3N1Y3Vyc2FsX2RpcmVjY2lvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAnZGlzY291bnRfcGN0JyxcclxuICAgICAgICB0eXBlOiAnbnVtYmVyJyxcclxuICAgICAgICBkZXNjOiAnZGVzY3VlbnRvIHRvdGFsIGRlbCBwZWRpZG8gKGFwbGljYWRvIGEgbml2ZWwgaGVhZGVyLCBwcm9ycmF0ZWFyIGVuIHBpcGVsaW5lKScsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAnc3VidG90YWxfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdzdWJ0b3RhbCBicnV0byBBUlMnIH0sXHJcbiAgICAgIHsgY29sOiAnbmV0X2Ftb3VudF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ25ldG8gQVJTIHBvc3QtZGVzY3VlbnRvJyB9LFxyXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF92aWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2R0d19tYW51YWwgfCBzZXJ2aWNlX2xheWVyJyB9LFxyXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF9kb2NfbnVtJywgdHlwZTogJ2ludCcsIGRlc2M6ICdudW1lcm8gZGUgUXVvdGF0aW9uIFNBUCcgfSxcclxuICAgICAgeyBjb2w6ICd0cmFuc2Zlcmlkb19zYXBfZG9jX2VudHJ5JywgdHlwZTogJ2ludCcsIGRlc2M6ICdkb2MgZW50cnkgaW50ZXJubyBTQVAnIH0sXHJcbiAgICAgIHsgY29sOiAndHJhbnNmZXJpZG9fc2FwX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcclxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcclxuICAgICAgeyBjb2w6ICdsaW5lX2luZGV4JywgdHlwZTogJ2ludCcsIGRlc2M6ICdpbmRpY2UgZGUgbGluZWEgMC1iYXNlZCcgfSxcclxuICAgICAgeyBjb2w6ICdsaW5lX2NvZGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVScgfSxcclxuICAgICAgeyBjb2w6ICdsaW5lX2Rlc2MnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2Rlc2NyaXBjaW9uIHByb2R1Y3RvJyB9LFxyXG4gICAgICB7IGNvbDogJ2xpbmVfcXR5JywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdjYW50aWRhZCcgfSxcclxuICAgICAgeyBjb2w6ICdsaW5lX3ByZWNpbycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAncHJlY2lvIHVuaXRhcmlvIEFSUycgfSxcclxuICAgICAgeyBjb2w6ICdsaW5lX2NhdCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2F0ZWdvcmlhJyB9LFxyXG4gICAgICB7IGNvbDogJ2xpbmVfZmFtJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdmYW1pbGlhJyB9LFxyXG4gICAgICB7IGNvbDogJ2xpbmVfc3ViJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzdWJmYW1pbGlhJyB9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIHZpc2l0YXM6IHtcclxuICAgIG5hbWU6ICd2aXNpdGFzLmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ3Zpc2l0cycsXHJcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7IGNvbDogJ3Zpc2l0X2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxyXG4gICAgICB7IGNvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIGRlbCB2ZW5kZWRvcicgfSxcclxuICAgICAgeyBjb2w6ICdvd25lcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIHZlbmRlZG9yJyB9LFxyXG4gICAgICB7IGNvbDogJ2ZlY2hhJywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnWVlZWS1NTS1ERCAoZmVjaGEgZGUgdmlzaXRhLCBubyBVVEMpJyB9LFxyXG4gICAgICB7IGNvbDogJ21lcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnSlVOSU8sIEpVTElPLCBldGMuJyB9LFxyXG4gICAgICB7IGNvbDogJ2FuaW8nLCB0eXBlOiAnaW50JywgZGVzYzogJ2FubycgfSxcclxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjYW5vbmljbyB2ZW5kZWRvcicgfSxcclxuICAgICAgeyBjb2w6ICdwcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Byb3ZpbmNpYScgfSxcclxuICAgICAgeyBjb2w6ICdsb2NhbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2xvY2FsaWRhZCcgfSxcclxuICAgICAgeyBjb2w6ICd0aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSB0aWVuZGEnIH0sXHJcbiAgICAgIHsgY29sOiAndGlwbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQyB8IFAnIH0sXHJcbiAgICAgIHsgY29sOiAnbG9jYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFByb3BpbywgQWxxdWlsYWRvJyB9LFxyXG4gICAgICB7IGNvbDogJ3RhbWFubycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ2hpY28sIE1lZGlhbm8sIEdyYW5kZScgfSxcclxuICAgICAgeyBjb2w6ICdmaWRlbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0FsdGEsIE1lZGlhLCBCYWphJyB9LFxyXG4gICAgICB7IGNvbDogJ3JlbGV2YW5jaWEnLCB0eXBlOiAnaW50JywgZGVzYzogJzAtNScgfSxcclxuICAgICAgeyBjb2w6ICdwb3AnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFN0aWNrZXJzIFNoaW1hbm8nIH0sXHJcbiAgICAgIHsgY29sOiAnbmVjZXNpZGFkX3B1bnR1YWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICd0aXBvX3ZlbnRhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBDYXNhIGRlIHBlc2NhICsgZWNvbW1lcmNlJyB9LFxyXG4gICAgICB7IGNvbDogJ3BvbmRlcmFjaW9uX21vc3RyYWRvJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcclxuICAgICAgeyBjb2w6ICdwb25kZXJhY2lvbl9lY29tbWVyY2UnLCB0eXBlOiAnaW50JywgZGVzYzogJzAtMTAwJyB9LFxyXG4gICAgICB7IGNvbDogJ2NvbXBldGVuY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnb3BvcnR1bmlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdtYXNfdmVuZGlkbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ21hc19wcmVndW50YW4nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdheXVkYV90aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdncHNfc3RhdHVzJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdvayB8IG91dHNpZGUgfCBub2xvYycgfSxcclxuICAgICAgeyBjb2w6ICdncHNfZGlzdGFuY2VfbScsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnbWV0cm9zJyB9LFxyXG4gICAgICB7IGNvbDogJ2ludGVyYWN0aW9uX3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Zpc2l0YSB8IGNvbnRhY3RvJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAnZm9ybWFfY29udGFjdG8nLFxyXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgIGRlc2M6ICdMTEFNQURBIFRFTEVGT05JQ0EgfCBNRU5TQUpFIERFIFdIQVRTQVBQIHwgTUVOU0FKRSBTTVMgKHNpIGNvbnRhY3RvKScsXHJcbiAgICAgIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBjb2w6ICdjb250YWN0b19yZXN1bHRhZG8nLFxyXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgIGRlc2M6ICdyZXNwb25kaW8gfCBub19yZXNwb25kaW8gfCB2YWNpbyAoc2luIG1hcmNhciwgc29sbyBhcGxpY2EgYSBjb250YWN0byknLFxyXG4gICAgICB9LFxyXG4gICAgICB7IGNvbDogJ2NvbnRhY3RvX3Jlc3VsdGFkb19hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnIH0sXHJcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGUgcXVpZW4gbWFyY28nIH0sXHJcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnIH0sXHJcbiAgICBdLFxyXG4gIH0sXHJcbiAgY2xpZW50ZXM6IHtcclxuICAgIG5hbWU6ICdjbGllbnRlcy5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICdjbGllbnRfYXBwbGljYXRpb25zJyxcclxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXHJcbiAgICBjb2x1bW5zOiBbXHJcbiAgICAgIHsgY29sOiAnYXBwX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxyXG4gICAgICB7IGNvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnb3duZXJfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2NvbWVyY2lvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdyYXpvbiBzb2NpYWwnIH0sXHJcbiAgICAgIHsgY29sOiAnZmFudGFzaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjb21lcmNpYWwnIH0sXHJcbiAgICAgIHsgY29sOiAnY3VpdCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnc29sbyBkaWdpdG9zIHBvc3QtdjI5NCcgfSxcclxuICAgICAgeyBjb2w6ICdjb25kaWNpb25fZmlzY2FsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnY2FsbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdudW1lcm8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdsb2NhbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdwcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdsb2NhbGlkYWRfZmluYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ292ZXJyaWRlIGRlbCBhcHJvYmFkb3InIH0sXHJcbiAgICAgIHsgY29sOiAnY2FyZF9jb2RlX3NhcCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQ2FyZENvZGUgU0FQJyB9LFxyXG4gICAgICB7IGNvbDogJ2Fzc2lnbmVkX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZGVkb3IgYXNpZ25hZG8gKHNvdXJjZSBvZiB0cnV0aCB2MzExKyknIH0sXHJcbiAgICAgIHsgY29sOiAnc3RhdHVzJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwZW5kaW5nX2FwcHJvdmFsIHwgYXBwcm92ZWQgfCByZWplY3RlZCcgfSxcclxuICAgICAge1xyXG4gICAgICAgIGNvbDogJ3NvdXJjZScsXHJcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgZGVzYzogJ21hbnVhbCB8IHNhcF9idWxrX2ltcG9ydCB8IGFsdGFfcmFwaWRhIHwgc2FwX3N5bmMgfCBzYXBfc3luY19tYW51YWxfbGluaycsXHJcbiAgICAgIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBjb2w6ICdtYW51YWxfc2FwX3BlbmRpbmcnLFxyXG4gICAgICAgIHR5cGU6ICdib29sZWFuJyxcclxuICAgICAgICBkZXNjOiAndHJ1ZT1wcm92aXNvcmlvIChBbHRhIFJhcGlkYSBzaW4gQ2FyZENvZGUpJyxcclxuICAgICAgfSxcclxuICAgICAgeyBjb2w6ICdwcmVjYXVjaW9uJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1jbGllbnRlIG1hcmNhZG8gcG9yIGltcGFnbycgfSxcclxuICAgICAgeyBjb2w6ICdjYXRlZ29yaWFfY2xpZW50ZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnUC9BL0IvQycgfSxcclxuICAgICAgeyBjb2w6ICdjbGlfdGlwbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQyBkZWZhdWx0IHBvc3QtdjM0OScgfSxcclxuICAgICAgeyBjb2w6ICdsYXQnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2dlb2xhdCcgfSxcclxuICAgICAgeyBjb2w6ICdsbmcnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2dlb2xuZycgfSxcclxuICAgICAgeyBjb2w6ICdoYXNfZ2VvJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAnbGF0L2xuZyBubyBudWxsJyB9LFxyXG4gICAgICB7IGNvbDogJ2hhc19hZGRyZXNzJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAnY2FsbGUgbm8gdmFjaWEnIH0sXHJcbiAgICAgIHsgY29sOiAnc3VibWl0dGVkX2J5X3B1YmxpY19mb3JtJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndmlhIGFsdGEtY2xpZW50ZS5odG1sJyB9LFxyXG4gICAgICB7IGNvbDogJ2FwcHJvdmVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgIF0sXHJcbiAgfSxcclxuICBjbGllbnRfbWFzdGVyOiB7XHJcbiAgICBuYW1lOiAnY2xpZW50X21hc3Rlci5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICdjbGllbnRfbWFzdGVyJyxcclxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXHJcbiAgICBjb2x1bW5zOiBbXHJcbiAgICAgIHsgY29sOiAnbWFzdGVyX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxyXG4gICAgICB7IGNvbDogJ2NsaWVudF9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnbG9jYWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAndmVuZG9yJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICd2ZW5kZWRvciBjdXJhZG8gYWRtaW4nIH0sXHJcbiAgICAgIHsgY29sOiAnYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIGN1cmFkYSBhZG1pbicgfSxcclxuICAgICAgeyBjb2w6ICdzYXBfY2FyZF9jb2RlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDYXJkQ29kZSBTQVAnIH0sXHJcbiAgICAgIHsgY29sOiAnc2FwX2FkZHJlc3MnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2RpcmVjY2lvbiByYXcgU0FQJyB9LFxyXG4gICAgICB7IGNvbDogJ3NhcF9jaXR5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnc2FwX3N0YXRlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnc2FwX2ltcG9ydGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3NhcF9pbXBvcnRlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2NsaWVudF9uYW1lX29yaWdpbmFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdiYWNrdXAgbm9tYnJlIHByZS1pbXBvcnQnIH0sXHJcbiAgICAgIHsgY29sOiAnbG9jYWxpZGFkX29yaWdpbmFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdiYWNrdXAgbG9jYWxpZGFkIHByZS1pbXBvcnQnIH0sXHJcbiAgICAgIHsgY29sOiAnbWF0Y2hfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZXhhY3QgfCBmdXp6eScgfSxcclxuICAgICAgeyBjb2w6ICdtYXRjaF9zaW1pbGFyaXR5JywgdHlwZTogJ251bWJlcicsIGRlc2M6ICcwLTEnIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICBdLFxyXG4gIH0sXHJcbiAgcmVuZGljaW9uZXM6IHtcclxuICAgIG5hbWU6ICdyZW5kaWNpb25lcy5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICdyZW5kaWNpb25lcycsXHJcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7IGNvbDogJ3JlbmRpY2lvbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcclxuICAgICAgeyBjb2w6ICdvd25lcl91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdvd25lcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2dhc3RvIHwgc29saWNpdHVkJyB9LFxyXG4gICAgICB7IGNvbDogJ3RpcG9fZ2FzdG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFBFQUpFUywgRkFDVFVSQSBBLCBHQVNUTyBDT04gQ09NUFJPQkFOVEUnIH0sXHJcbiAgICAgIHsgY29sOiAnaW1wb3J0ZV9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ21vbnRvIEFSUycgfSxcclxuICAgICAgeyBjb2w6ICdmZWNoYV9nYXN0bycsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ1lZWVktTU0tREQgZGVsIGdhc3RvJyB9LFxyXG4gICAgICB7IGNvbDogJ2NvbmNlcHRvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkZXNjcmlwY2lvbiBsaWJyZScgfSxcclxuICAgICAgeyBjb2w6ICdmb3RvX3RpY2tldF91cmwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VSTCBGaXJlYmFzZSBTdG9yYWdlIHYzMDgrIChudW5jYSBiYXNlNjQpJyB9LFxyXG4gICAgICB7IGNvbDogJ3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncGVuZGluZ19hcHByb3ZhbCB8IGFwcHJvdmVkIHwgcmVqZWN0ZWQnIH0sXHJcbiAgICAgIHsgY29sOiAnYXBwcm92ZWRfYnknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VtYWlsIGRlbCBhcHJvYmFkb3IgbyBcInNlbGZcIicgfSxcclxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdyZWplY3RlZF9ieV9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3JlamVjdGVkX3JlYXNvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2FwcHJvdmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIHJlc3BvbnNhYmxlIGFzaWduYWRvJyB9LFxyXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXHJcbiAgICBdLFxyXG4gIH0sXHJcbiAgY2FtcGFuaWFzOiB7XHJcbiAgICBuYW1lOiAnY2FtcGFuaWFzLmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ2NhbXBhaWducycsXHJcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7IGNvbDogJ2NhbXBhaWduX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxyXG4gICAgICB7IGNvbDogJ25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjYW1wYW5hJyB9LFxyXG4gICAgICB7IGNvbDogJ2ZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFJFRUxTJyB9LFxyXG4gICAgICB7IGNvbDogJ3N1YmZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIE1VTFRJUExJQ0FET1JFUycgfSxcclxuICAgICAgeyBjb2w6ICdmaWx0ZXJfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnc2t1IChob3kgaGFyZGNvZGVkKScgfSxcclxuICAgICAgeyBjb2w6ICdmaWx0ZXJfdmFsdWVzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdjb3BpYSBkZSBza3VzJyB9LFxyXG4gICAgICB7IGNvbDogJ3NrdXNfanNvbicsIHR5cGU6ICdqc29uX2FycmF5JywgZGVzYzogJ0l0ZW1Db2RlcyBpbmNsdWlkb3MnIH0sXHJcbiAgICAgIHsgY29sOiAnc2t1c19jb3VudCcsIHR5cGU6ICdpbnQnLCBkZXNjOiAnY2FudGlkYWQgU0tVcycgfSxcclxuICAgICAgeyBjb2w6ICd0YXJnZXRfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndW5pdHMgfCBtb25leScgfSxcclxuICAgICAgeyBjb2w6ICd0YXJnZXRfYW1vdW50JywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdvYmpldGl2bycgfSxcclxuICAgICAgeyBjb2w6ICdzdGFydF9kYXRlJywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnWVlZWS1NTS1ERCcgfSxcclxuICAgICAgeyBjb2w6ICdlbmRfZGF0ZScsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ1lZWVktTU0tREQnIH0sXHJcbiAgICAgIHsgY29sOiAnc2NvcGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2FsbCB8IHByb3ZpbmNlIHwgdmVuZG9yJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAnc2NvcGVfdmFsdWVzX2pzb24nLFxyXG4gICAgICAgIHR5cGU6ICdqc29uX2FycmF5JyxcclxuICAgICAgICBkZXNjOiAncHJvdmluY2lhcyBvIHZlbmRvciBrZXlzIHNpIHNjb3BlICE9IGFsbCcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIGFkbWluL2dlcmVudGUnIH0sXHJcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9ieV9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnYXJjaGl2ZWRfbWFudWFsbHknLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWZpbmFsaXphZGEgYW50ZXMgZGUgZW5kRGF0ZScgfSxcclxuICAgICAgeyBjb2w6ICdhcmNoaXZlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdhcmNoaXZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIHRhcmdldHM6IHtcclxuICAgIG5hbWU6ICd0YXJnZXRzLmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ3RhcmdldHMnLFxyXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcclxuICAgIGNvbHVtbnM6IFtcclxuICAgICAgeyBjb2w6ICd0YXJnZXRfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgY2Fub25pY28ge3ZlbmRvcn1fe3llYXJ9X3tNTX0nIH0sXHJcbiAgICAgIHsgY29sOiAnc2VsbGVyX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICd2ZW5kb3JLZXkgdXBwZXJjYXNlIGVqIEdPTlpBTE8gREUgTEEgUk9TQScgfSxcclxuICAgICAgeyBjb2w6ICd5ZWFyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdlaiAyMDI2JyB9LFxyXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExIChpbmRpY2UgZGVsIGFycmF5IE1FU0VTIDAtaW5kZXhlZCknIH0sXHJcbiAgICAgIHsgY29sOiAndGFyZ2V0X2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnb2JqZXRpdm8gbWVzIEFSUyAoc3VtYSBmYW1pbGlhcyknIH0sXHJcbiAgICAgIHsgY29sOiAndGFyZ2V0X3JlZWxfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICd2MzExKyBkZXNnbG9zZScgfSxcclxuICAgICAgeyBjb2w6ICd0YXJnZXRfY2FuYXNfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICd2MzExKyBkZXNnbG9zZScgfSxcclxuICAgICAgeyBjb2w6ICd0YXJnZXRfbGluZWFzX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAndjMxMSsgZGVzZ2xvc2UnIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQnIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9ieV9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIHByb2R1Y3Rvczoge1xyXG4gICAgbmFtZTogJ3Byb2R1Y3Rvcy5jc3YnLFxyXG4gICAgc291cmNlOiAnc3RvY2tfanNvbicsXHJcbiAgICByb3dNb2RlOiAnZnJvbV9zdG9ja19qc29uJyxcclxuICAgIGNvbHVtbnM6IFtcclxuICAgICAgeyBjb2w6ICdza3UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVSAoSXRlbUNvZGUgU0FQKScgfSxcclxuICAgICAgeyBjb2w6ICdoYXNfc3RvY2snLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWhheSB1bmlkYWRlcyBlbiBhbGd1biB3aHMgdmVuZGlibGUnIH0sXHJcbiAgICAgIHsgY29sOiAnY2FudGlkYWRfdG90YWwnLCB0eXBlOiAnaW50JywgZGVzYzogJ3N1bWEgdG90YWwgd2hzIHZlbmRpYmxlcyAoZXhjbHV5ZSAwNSB5IDA2KScgfSxcclxuICAgICAge1xyXG4gICAgICAgIGNvbDogJ2Rpc3BvbmlibGVfdmVudGFfd2hzMTEnLFxyXG4gICAgICAgIHR5cGU6ICdpbnQnLFxyXG4gICAgICAgIGRlc2M6ICd2MzY5KyBNZXJjYWRlcmlhIE5VUiBQRVNDQSAodmVudGEgZGlyZWN0YSknLFxyXG4gICAgICB9LFxyXG4gICAgICB7IGNvbDogJ3RyYW5zaXRvX3doczEyJywgdHlwZTogJ2ludCcsIGRlc2M6ICd2MzY5KyBFbiB0cmFuc2l0byBQRVNDQSAoYmFja29yZGVyIGZ1dHVybyknIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBjb2w6ICdvdHJvc193YXJlaG91c2VzX2pzb24nLFxyXG4gICAgICAgIHR5cGU6ICdqc29uX29iamVjdCcsXHJcbiAgICAgICAgZGVzYzogJ290cm9zIGNvZGlnb3MgY29uIGNhbnRpZGFkLCBlaiB7XCI5OFwiOiA1fScsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAnc291cmNlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzdG9jay5qc29uIHNuYXBzaG90JyB9LFxyXG4gICAgICB7IGNvbDogJ3NuYXBzaG90X3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgZGVsIHVsdGltbyBzeW5jIFNBUCcgfSxcclxuICAgIF0sXHJcbiAgfSxcclxuICB2ZW5kb3Jfb3ZlcnJpZGVzOiB7XHJcbiAgICBuYW1lOiAndmVuZG9yX292ZXJyaWRlcy5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICd2ZW5kb3Jfb3ZlcnJpZGVzJyxcclxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXHJcbiAgICBjb2x1bW5zOiBbXHJcbiAgICAgIHsgY29sOiAnb3ZlcnJpZGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXHJcbiAgICAgIHsgY29sOiAnc2NvcGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Nob3AgfCBsb2MnIH0sXHJcbiAgICAgIHsgY29sOiAncHJvdmluY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdsb2NhbGl0eV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3NvbG8gc2kgc2NvcGU9c2hvcCcgfSxcclxuICAgICAgeyBjb2w6ICdvcmlnaW5hbF92ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICduZXdfdmVuZG9yJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnbmV3X3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1ZERSB8IFZESSB8IERJU1RSSUJVSURPUiB8IE9UUk8nIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X2Rpc3BsYXlfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIGN1c3RvbV9yb3V0ZXM6IHtcclxuICAgIG5hbWU6ICdjdXN0b21fcm91dGVzLmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ2N1c3RvbV9yb3V0ZXMnLFxyXG4gICAgcm93TW9kZTogJ2ZsYXR0ZW5fc3RvcHMnLCAvLyAxIGZpbGEgcG9yIChydXRhLCBzdG9wKVxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7IGNvbDogJ3JvdXRlX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxyXG4gICAgICB7IGNvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZHVlbmlvIGRlIGxhIHJ1dGEnIH0sXHJcbiAgICAgIHsgY29sOiAnb3duZXJfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICduYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdub21icmUgZGUgbGEgcnV0YScgfSxcclxuICAgICAgeyBjb2w6ICdwbGFubmVkX2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxyXG4gICAgICB7IGNvbDogJ25vdGVzJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdub3RhcyBsaWJyZXMnIH0sXHJcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3N0b3Bfb3JkZXInLCB0eXBlOiAnaW50JywgZGVzYzogJ29yZGVuIDAtYmFzZWQnIH0sXHJcbiAgICAgIHsgY29sOiAnc3RvcF9rZXknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2NsYXZlIGNvbXB1ZXN0YSB0aXBvfHByb3Z8bG9jfGNsaWVudGUnIH0sXHJcbiAgICAgIHsgY29sOiAnc3RvcF90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIHwgUCcgfSxcclxuICAgICAgeyBjb2w6ICdzdG9wX3Byb3ZpbmNpYScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3N0b3BfbG9jYWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnc3RvcF9jbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3N0b3BfaXNfcHJvdmlzb3JpbycsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWU9YWx0YSByYXBpZGEgc2luIENhcmRDb2RlJyB9LFxyXG4gICAgICB7IGNvbDogJ3N0b3Bfc2FwX2FsdGFfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0lEIGRlbCBjbGllbnRfYXBwbGljYXRpb25zIHNpIGFwbGljYScgfSxcclxuICAgIF0sXHJcbiAgfSxcclxuICBzZWd1aW1pZW50b19ub3Rlczoge1xyXG4gICAgbmFtZTogJ3NlZ3VpbWllbnRvX25vdGVzLmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ3NlZ3VpbWllbnRvX25vdGVzJyxcclxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXHJcbiAgICBjb2x1bW5zOiBbXHJcbiAgICAgIHsgY29sOiAnbm90ZV9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcclxuICAgICAgeyBjb2w6ICd2ZW5kb3JfZXh0JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgYWwgcXVlIGFwbGljYSBsYSBub3RhJyB9LFxyXG4gICAgICB7IGNvbDogJ2NsaWVudF9rZXknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2NsYXZlIGNvbXB1ZXN0YSBjbGllbnRlJyB9LFxyXG4gICAgICB7IGNvbDogJ2NsaWVudF9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAncHJvdmluY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdsb2NhbGl0eScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3RleHQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3RleHRvIGxpYnJlIGRlIGxhIG5vdGEnIH0sXHJcbiAgICAgIHsgY29sOiAnYXV0aG9yX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2F1dGhvcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2F1dGhvcl9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnYXV0aG9yX3JvbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2FkbWluIHwgZ2VyZW50ZSB8IGludGVybm8nIH0sXHJcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgIF0sXHJcbiAgfSxcclxuICAvLyB2NzMyICgyMDI2LTA4LTI5KTogMyBzbmFwc2hvdHMgQlEtPkZpcmVzdG9yZSBhaG9yYSBpbmNsdWlkb3MgZW4gZWwgZGF0YXNldCBNTC5cclxuICAvLyBBbnRlcyBlc3RhYmFuIGVuIGV4Y2x1ZGVkQ29sbGVjdGlvbnMgZGVsIG1hbmlmZXN0LiBSYWNpb25hbDogc29uIGZ1ZW50ZSBkZVxyXG4gIC8vIHZlcmRhZCBkZSBmYWN0dXJhY2lvbiBSRUFMIFNBUCAobmV0byBOQ3MpLCBkZW1hbmQtc3VwcmVzc2lvbiAoYmFja29yZGVycylcclxuICAvLyB5IGFncmVnYWRvcyBkaWFyaW9zIGxpc3Rvcy1wYXJhLWJlbmNobWFyay5cclxuICBzYXBfc25hcHNob3Q6IHtcclxuICAgIG5hbWU6ICdzYXBfc25hcHNob3QuY3N2JyxcclxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXHJcbiAgICBjb2xsZWN0aW9uOiAnc2FwX3NuYXBzaG90JyxcclxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXHJcbiAgICBjb2x1bW5zOiBbXHJcbiAgICAgIHsgY29sOiAnZG9jX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEIChWRU5ET1JfTk9STV9ZWVlZX01NKScgfSxcclxuICAgICAge1xyXG4gICAgICAgIGNvbDogJ3ZlbmRvcl9rZXknLFxyXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgIGRlc2M6ICdub21icmUgZGVsIHZlbmRlZG9yIHRhbCBjdWFsIHZpZW5lIGRlIFNBUCAoc2luIG5vcm1hbGl6YXIpJyxcclxuICAgICAgfSxcclxuICAgICAgeyBjb2w6ICdhbmlvJywgdHlwZTogJ2ludGVnZXInLCBkZXNjOiAnYW5pbyBjYWxlbmRhcmlvJyB9LFxyXG4gICAgICB7IGNvbDogJ21lcycsIHR5cGU6ICdpbnRlZ2VyJywgZGVzYzogJzEtMTInIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBjb2w6ICdmYWN0dXJhZG9fYXJzX25ldG8nLFxyXG4gICAgICAgIHR5cGU6ICdudW1iZXInLFxyXG4gICAgICAgIGRlc2M6ICdmYWN0dXJhcyAtIE5DcyBBUlMgKGNvbiBJVkEgY2FyZ2FkbyBlbiBlbCBpbXBvcnRlKScsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAnZmFjdHVyYWRvX2Fyc19icnV0bycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnZmFjdHVyYXMgKyBOQ3Mgc3VtYWRhcyBBUlMgYnJ1dG8nIH0sXHJcbiAgICAgIHsgY29sOiAnbmNzX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnbW9udG8gZGUgbm90YXMgZGUgY3JlZGl0byBBUlMnIH0sXHJcbiAgICAgIHsgY29sOiAnZmFjdHVyYXNfY291bnQnLCB0eXBlOiAnaW50ZWdlcicsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnbmNzX2NvdW50JywgdHlwZTogJ2ludGVnZXInLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3VuaWRhZGVzX25ldG8nLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3N1bShxdHkpIGZhY3R1cmFzIC0gc3VtKHF0eSkgTkNzJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAnaW1wb3J0ZV9saW5lYXNfYXJzX25ldG8nLFxyXG4gICAgICAgIHR5cGU6ICdudW1iZXInLFxyXG4gICAgICAgIGRlc2M6ICdzdW0gaW1wb3J0ZXMgZGUgbGluZWEgKHNpbiBJVkEpOyB1c2FyIGVzdGUgY2FtcG8gcGFyYSBtb2RlbG9zIGRlIG5lZ29jaW8gLSBmYWN0dXJhZG9fYXJzX25ldG8gaW5jbHV5ZSBJVkEgeSBzb2JyZWVzdGltYScsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBkZWwgc3luYyBCUS0+RmlyZXN0b3JlJyB9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIGZhY3R1cmFjaW9uX3NuYXBzaG90OiB7XHJcbiAgICBuYW1lOiAnZmFjdHVyYWNpb25fc25hcHNob3QuY3N2JyxcclxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXHJcbiAgICBjb2xsZWN0aW9uOiAnZmFjdHVyYWNpb25fc25hcHNob3QnLFxyXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcclxuICAgIGNvbHVtbnM6IFtcclxuICAgICAgeyBjb2w6ICdkb2NfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgKFZFTkRPUl9OT1JNIG8gVE9UQUxfTkFDSU9OQUwpJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAndmVuZG9yX2tleScsXHJcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgZGVzYzogJ25vbWJyZSBjYW5vbmljbyBkZWwgdmVuZGVkb3IgLSBUT1RBTF9OQUNJT05BTCBwYXJhIGVsIHJvbGx1cCBuYWNpb25hbCcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAnaG95X2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnZmFjdHVyYWNpb24gZGVsIGRpYSBhY3R1YWwgQVJTJyB9LFxyXG4gICAgICB7IGNvbDogJ21lc19hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2ZhY3R1cmFjaW9uIE1URCBkZWwgbWVzIGFjdHVhbCBBUlMnIH0sXHJcbiAgICAgIHsgY29sOiAnYW5vX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnZmFjdHVyYWNpb24gWVREIGRlbCBhbmlvIGFjdHVhbCBBUlMnIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBkZWwgdWx0aW1vIHN5bmMnIH0sXHJcbiAgICBdLFxyXG4gIH0sXHJcbiAgYmFja29yZGVyX3NuYXBzaG90OiB7XHJcbiAgICBuYW1lOiAnYmFja29yZGVyX3NuYXBzaG90LmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ2JhY2tvcmRlcl9zbmFwc2hvdCcsXHJcbiAgICByb3dNb2RlOiAnb25lX3Blcl9saW5lJyxcclxuICAgIGNvbHVtbnM6IFtcclxuICAgICAge1xyXG4gICAgICAgIGNvbDogJ2RvY19pZCcsXHJcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgKFZFTkRPUl9OT1JNKTsgdW4gZG9jID0gdW4gdmVuZGVkb3IsIHJlcGxpY2FkbyBlbiBjYWRhIGxpbmVhJyxcclxuICAgICAgfSxcclxuICAgICAgeyBjb2w6ICd2ZW5kb3Jfa2V5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdub21icmUgZGVsIHZlbmRlZG9yIHNpbiBub3JtYWxpemFyJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAnbGluZXNfY291bnQnLFxyXG4gICAgICAgIHR5cGU6ICdpbnRlZ2VyJyxcclxuICAgICAgICBkZXNjOiAnY2FudGlkYWQgdG90YWwgZGUgbGluZWFzIGVuIGVsIHNuYXBzaG90IGRlbCB2ZW5kZWRvciAocmVwbGljYWRvIGVuIGNhZGEgcm93IHBhcmEgam9pbnMpJyxcclxuICAgICAgfSxcclxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3NrdScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnU0tVIGRlbCBwcm9kdWN0byBlbiBiYWNrb3JkZXIgKHNvbG8gUEVTQ0EpJyB9LFxyXG4gICAgICB7IGNvbDogJ3Byb2R1Y3RvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdub21icmUgZGVsIHByb2R1Y3RvJyB9LFxyXG4gICAgICB7IGNvbDogJ2ZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdzdWJmYW1pbGlhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAncGVuZGllbnRlJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICd1bmlkYWRlcyBwZW5kaWVudGVzIGRlIGRlc3BhY2hvIChiYWNrb3JkZXIpJyB9LFxyXG4gICAgICB7IGNvbDogJ3BlZGlkbycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAndW5pZGFkZXMgcGVkaWRhcyBvcmlnaW5hbG1lbnRlIGVuIGxhIFNRJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAnc3RvY2tfYWN0dWFsJyxcclxuICAgICAgICB0eXBlOiAnaW50ZWdlcicsXHJcbiAgICAgICAgZGVzYzogJ3N0b2NrIGRpc3BvbmlibGUgZGVsIFNLVSBhbCBtb21lbnRvIGRlbCBzbmFwc2hvdCcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAncHJlY2lvX3VuaXRhcmlvJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdwcmVjaW8gdW5pdGFyaW8gQVJTJyB9LFxyXG4gICAgICB7IGNvbDogJ2NsaWVudGVfY29kZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2FyZENvZGUgU0FQIGRlbCBjbGllbnRlJyB9LFxyXG4gICAgICB7IGNvbDogJ2NsaWVudGVfbm9tYnJlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnY2xpZW50ZV9jaXVkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdzcV9kb2NfbnVtJywgdHlwZTogJ2ludGVnZXInLCBkZXNjOiAnbnVtZXJvIGRlIFNhbGVzIFF1b3RhdGlvbiBTQVAnIH0sXHJcbiAgICAgIHsgY29sOiAnc3FfZG9jX2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdmZWNoYSBkZSBsYSBTUScgfSxcclxuICAgICAgeyBjb2w6ICdlc3RhZG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VzdGFkbyBkZWwgYmFja29yZGVyIHNlZ3VuIFNBUCcgfSxcclxuICAgIF0sXHJcbiAgfSxcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBEQVRBU0VUX1VTRV9DQVNFX01BVFJJWCBcdTIwMTQgY2Fzb3MgZGUgdXNvIE1MIGNvbiBjYW1wb3MgcmVxdWVyaWRvc1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8qKiBAdHlwZWRlZiB7e3ByaW9yaXR5OiBudW1iZXJ8c3RyaW5nLCBkZXNjcmlwdGlvbjogc3RyaW5nLCByZXF1aXJlZEZpZWxkczogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+LCBqb2luTm90ZXM/OiBzdHJpbmd9fSBVc2VDYXNlICovXHJcblxyXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFVzZUNhc2U+fSAqL1xyXG5leHBvcnQgY29uc3QgREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVggPSB7XHJcbiAgQV9jb252ZXJzaW9uX3Zpc2l0YV9wZWRpZG86IHtcclxuICAgIHByaW9yaXR5OiAxLFxyXG4gICAgZGVzY3JpcHRpb246ICdQcmVkZWNpciBxdWUgdmlzaXRhcyB0ZXJtaW5hbiBlbiBwZWRpZG8gcGFyYSBwcmlvcml6YXIgbGEgcnV0YSBkZWwgdmVuZGVkb3IuJyxcclxuICAgIHJlcXVpcmVkRmllbGRzOiB7XHJcbiAgICAgICd2aXNpdGFzLmNzdic6IFsnZmVjaGEnLCAnb3duZXJfdWlkJywgJ3Byb3ZpbmNpYScsICdsb2NhbGlkYWQnLCAndGllbmRhJ10sXHJcbiAgICAgICdwZWRpZG9zLmNzdic6IFsnY29uZmlybWVkX2F0JywgJ293bmVyX3VpZCcsICdwcm92aW5jZScsICdsb2NfbmFtZScsICdjbGllbnRfbmFtZSddLFxyXG4gICAgfSxcclxuICAgIGpvaW5Ob3RlczpcclxuICAgICAgJ0pPSU4gcG9yIChwcm92aW5jaWEsIGxvY2FsaWRhZCwgdGllbmRhfmNsaWVudF9uYW1lKSBlbiB2ZW50YW5hIHRlbXBvcmFsIGZlY2hhX3Zpc2l0YS4uY29uZmlybWVkX2F0LiBObyBoYXkgY2FyZENvZGVTYXAgY29tdW4gZW50cmUgdmlzaXRzIHkgcGVkaWRvcy4nLFxyXG4gIH0sXHJcbiAgQl9jaHVybl9jbGllbnRlczoge1xyXG4gICAgcHJpb3JpdHk6IDIsXHJcbiAgICBkZXNjcmlwdGlvbjogJ0RldGVjdGFyIGNsaWVudGVzIHF1ZSBzZSBlbmZyaWFuIGFudGVzIGRlIHBlcmRlcmxvcy4nLFxyXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcclxuICAgICAgJ2NsaWVudGVzLmNzdic6IFsnY3JlYXRlZF9hdCcsICdhc3NpZ25lZF92ZW5kb3InLCAncHJvdmluY2lhJywgJ3N0YXR1cycsICdjYXJkX2NvZGVfc2FwJ10sXHJcbiAgICAgICdwZWRpZG9zLmNzdic6IFsnY29uZmlybWVkX2F0JywgJ2NsaWVudF9uYW1lJywgJ3Byb3ZpbmNlJywgJ2xvY19uYW1lJ10sXHJcbiAgICB9LFxyXG4gICAgam9pbk5vdGVzOlxyXG4gICAgICAnSk9JTiB2aWEgY2xpZW50X2FwcGxpY2F0aW9ucy5jYXJkX2NvZGVfc2FwIHZzIHBlZGlkb3Mua2V5IChwYXJzZWFkbykuIEZyYWdpbCAtIGNvbnNpZGVyYXIgZnV6enkgbWF0Y2ggcG9yIG5vbWJyZS4nLFxyXG4gIH0sXHJcbiAgQ19mb3JlY2FzdF9za3U6IHtcclxuICAgIHByaW9yaXR5OiAzLFxyXG4gICAgZGVzY3JpcHRpb246ICdBbnRpY2lwYXIgcXVlIHByb2R1Y3RvcyBzZSB2YW4gYSBwZWRpciBwb3IgcGVyaW9kby4nLFxyXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcclxuICAgICAgJ3BlZGlkb3MuY3N2JzogWydsaW5lX2NvZGUnLCAnbGluZV9xdHknLCAnbGluZV9wcmVjaW8nLCAnY29uZmlybWVkX2F0JywgJ3Byb3ZpbmNlJ10sXHJcbiAgICAgICdwcm9kdWN0b3MuY3N2JzogWydza3UnXSxcclxuICAgIH0sXHJcbiAgICBqb2luTm90ZXM6XHJcbiAgICAgICdEZXNjdWVudG8gYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIgKGRpc2NvdW50X3BjdCkgLSBwcm9ycmF0ZWFyIGVuIGVsIHBpcGVsaW5lIGRvd25zdHJlYW0gcHJvcG9yY2lvbmFsIGEgc3VidG90YWxfYnJ1dG8gZGUgY2FkYSBsaW5lYS4gRW5yaXF1ZWNlciBjb24gY2F0YWxvZ28gQlEgKHNhcF9pdGVtc19yYXcpIHNpIGhhY2UgZmFsdGEgY2F0L2ZhbS9zdWIgYWRpY2lvbmFsLicsXHJcbiAgfSxcclxuICBEX2Fub21hbGlhc19yZW5kaWNpb25lczoge1xyXG4gICAgcHJpb3JpdHk6ICdleHBsb3JhdG9yaW8nLFxyXG4gICAgZGVzY3JpcHRpb246ICdEZXRlY3RhciBvdXRsaWVycyBkZSBnYXN0b3MuJyxcclxuICAgIHJlcXVpcmVkRmllbGRzOiB7XHJcbiAgICAgICdyZW5kaWNpb25lcy5jc3YnOiBbJ2ltcG9ydGVfYXJzJywgJ3RpcG9fZ2FzdG8nLCAnb3duZXJfdWlkJywgJ2ZlY2hhX2dhc3RvJywgJ3N0YXR1cyddLFxyXG4gICAgfSxcclxuICB9LFxyXG4gIEVfZXN0YWNpb25hbGlkYWRfem9uYV9jYXRlZ29yaWE6IHtcclxuICAgIHByaW9yaXR5OiAnZXhwbG9yYXRvcmlvJyxcclxuICAgIGRlc2NyaXB0aW9uOiAnSW5zdW1vIHBhcmEgYXJtYWRvIGRlIGNhbXBhbmlhcyBlc3RhY2lvbmFsZXMuJyxcclxuICAgIHJlcXVpcmVkRmllbGRzOiB7XHJcbiAgICAgICdwZWRpZG9zLmNzdic6IFsnY29uZmlybWVkX2F0JywgJ3Byb3ZpbmNlJywgJ2xpbmVfY29kZScsICdsaW5lX2ZhbScsICdsaW5lX3F0eSddLFxyXG4gICAgICAnY2xpZW50ZXMuY3N2JzogWydwcm92aW5jaWEnLCAnYXNzaWduZWRfdmVuZG9yJ10sXHJcbiAgICAgICdjYW1wYW5pYXMuY3N2JzogWydzdGFydF9kYXRlJywgJ2VuZF9kYXRlJywgJ3NrdXNfanNvbicsICdzY29wZSddLFxyXG4gICAgICAndGFyZ2V0cy5jc3YnOiBbJ3llYXInLCAnbW9udGgnLCAndGFyZ2V0X2FycyddLFxyXG4gICAgfSxcclxuICB9LFxyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFJvdyBidWlsZGVycyBcdTIwMTQgZnVuY2lvbmVzIHB1cmFzIChkb2MgLT4gYXJyYXkgZGUgcm93cylcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG4vKipcclxuICogRXh0cmFlIHZhbG9yIEZpcmVzdG9yZSBkZSBkb2MgY29uIHBhdGggYW5pZGFkby4gRGV2dWVsdmUgcmF3IChubyBDU1YpLlxyXG4gKiBFajogZ2V0RmllbGQoZG9jLCAndHJhbnNmZXJpZG9TQVAuZG9jTnVtJylcclxuICogQHBhcmFtIHtvYmplY3R9IGRvY1xyXG4gKiBAcGFyYW0ge3N0cmluZ30gcGF0aFxyXG4gKi9cclxuZnVuY3Rpb24gZihkb2MsIHBhdGgpIHtcclxuICByZXR1cm4gZ2V0UGF0aChkb2MsIHBhdGgpO1xyXG59XHJcblxyXG4vKipcclxuICogUm93IGJ1aWxkZXIgZ2VuZXJpY286IG1hcGVhIHVuIGRvYyBhIGFycmF5IGRlIHZhbG9yZXMgc2VndW4gdW4gYXJyYXkgZGUgcGF0aHMuXHJcbiAqIEBwYXJhbSB7b2JqZWN0fSBkb2NcclxuICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aHNcclxuICogQHJldHVybnMge3Vua25vd25bXX1cclxuICovXHJcbmZ1bmN0aW9uIF9idWlsZFJvdyhkb2MsIHBhdGhzKSB7XHJcbiAgcmV0dXJuIHBhdGhzLm1hcCgocCkgPT4gKHAgPT09ICdfX2lkX18nID8gLyoqIEB0eXBlIHthbnl9ICovIChkb2MpLl9pZCA6IGYoZG9jLCBwKSkpO1xyXG59XHJcblxyXG4vKipcclxuICogUGVkaWRvczogZmxhdHRlbiAxIGZpbGEgcG9yIGxpbmVhLiBIZWFkZXIgcGVkaWRvIHJlcGxpY2FkbyBlbiBjYWRhLlxyXG4gKiBkb2MuX2lkIGVzIGVsIElEOyBzZSBlc3BlcmEgcXVlIGVsIGNhbGxlciBsbyBhZ3JlZ3VlIGFudGVzIGRlIHBhc2FyLlxyXG4gKiBAcGFyYW0ge2FueX0gZG9jXHJcbiAqIEByZXR1cm5zIHt1bmtub3duW11bXX1cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZFBlZGlkb1Jvd3MoZG9jKSB7XHJcbiAgY29uc3QgaGVhZGVyID0gW1xyXG4gICAgZG9jLl9pZCxcclxuICAgIGRvYy5vd25lclVpZCxcclxuICAgIGRvYy5vd25lckVtYWlsLFxyXG4gICAgZG9jLmNyZWF0ZWRCeVVpZCxcclxuICAgIGRvYy5vbkJlaGFsZk9mLFxyXG4gICAgZG9jLmtleSxcclxuICAgIGRvYy5zdGFnZSxcclxuICAgIGRvYy50aXBvLFxyXG4gICAgZG9jLnByb3ZpbmNlLFxyXG4gICAgZG9jLmxvY05hbWUsXHJcbiAgICBkb2MuY2xpZW50TmFtZSxcclxuICAgIGRvYy5tb250aCxcclxuICAgIGRvYy5tb250aElkeCxcclxuICAgIGRvYy55ZWFyLFxyXG4gICAgZG9jLmNvbmZpcm1lZEF0LFxyXG4gICAgZG9jLmNvbmRpY2lvblBhZ28sXHJcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50aXBvIDogbnVsbCxcclxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLnRyYW5zcE5vbWJyZSA6IG51bGwsXHJcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50cmFuc3BEaXJlY2Npb24gOiBudWxsLFxyXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2EuY2xpZW50ZURpcmVjY2lvbiA6IG51bGwsXHJcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS5zdWN1cnNhbERpcmVjY2lvbiA6IG51bGwsXHJcbiAgICBkb2MuZGlzY291bnRQY3QsXHJcbiAgICBkb2Muc3VidG90YWxBcnMsXHJcbiAgICBkb2MubmV0QW1vdW50QXJzLFxyXG4gICAgZG9jLnRyYW5zZmVyaWRvU0FQID8gZG9jLnRyYW5zZmVyaWRvU0FQLnZpYSA6IG51bGwsXHJcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuZG9jTnVtIDogbnVsbCxcclxuICAgIGRvYy50cmFuc2Zlcmlkb1NBUCA/IGRvYy50cmFuc2Zlcmlkb1NBUC5kb2NFbnRyeSA6IG51bGwsXHJcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuYXQgOiBudWxsLFxyXG4gICAgZG9jLmNyZWF0ZWRBdCxcclxuICBdO1xyXG4gIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShkb2MubGluZXMpID8gZG9jLmxpbmVzIDogW107XHJcbiAgaWYgKCFsaW5lcy5sZW5ndGgpIHtcclxuICAgIC8vIFBlZGlkbyBzaW4gbGluZWFzIC0+IDEgZmlsYSBjb24gbGluZV8qIHZhY2lvc1xyXG4gICAgcmV0dXJuIFtoZWFkZXIuY29uY2F0KFtudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsXSldO1xyXG4gIH1cclxuICByZXR1cm4gbGluZXMubWFwKCgvKiogQHR5cGUge2FueX0gKi8gbCwgLyoqIEB0eXBlIHtudW1iZXJ9ICovIGlkeCkgPT5cclxuICAgIGhlYWRlci5jb25jYXQoW1xyXG4gICAgICBpZHgsXHJcbiAgICAgIGwgPyBsLmNvZGUgOiBudWxsLFxyXG4gICAgICBsID8gbC5kZXNjIDogbnVsbCxcclxuICAgICAgbCA/IGwucXR5IDogbnVsbCxcclxuICAgICAgbCA/IGwucHJlY2lvIDogbnVsbCxcclxuICAgICAgbCA/IGwuY2F0IDogbnVsbCxcclxuICAgICAgbCA/IGwuZmFtIDogbnVsbCxcclxuICAgICAgbCA/IGwuc3ViIDogbnVsbCxcclxuICAgIF0pXHJcbiAgKTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWaXNpdGFSb3dzKGRvYykge1xyXG4gIHJldHVybiBbXHJcbiAgICBbXHJcbiAgICAgIGRvYy5faWQsXHJcbiAgICAgIGRvYy5vd25lclVpZCxcclxuICAgICAgZG9jLm93bmVyRW1haWwsXHJcbiAgICAgIGRvYy5mZWNoYSxcclxuICAgICAgZG9jLm1lcyxcclxuICAgICAgZG9jLmFuaW8sXHJcbiAgICAgIGRvYy52ZW5kb3IsXHJcbiAgICAgIGRvYy5wcm92aW5jaWEsXHJcbiAgICAgIGRvYy5sb2NhbGlkYWQsXHJcbiAgICAgIGRvYy50aWVuZGEsXHJcbiAgICAgIGRvYy50aXBvLFxyXG4gICAgICBkb2MubG9jYWwsXHJcbiAgICAgIGRvYy50YW1hbm8sXHJcbiAgICAgIGRvYy5maWRlbGlkYWQsXHJcbiAgICAgIGRvYy5yZWxldmFuY2lhLFxyXG4gICAgICBkb2MucG9wLFxyXG4gICAgICBkb2MubmVjZXNpZGFkUHVudHVhbCxcclxuICAgICAgZG9jLnRpcG9WZW50YSxcclxuICAgICAgZG9jLnBvbmRlcmFjaW9uTW9zdHJhZG8sXHJcbiAgICAgIGRvYy5wb25kZXJhY2lvbkVjb21tZXJjZSxcclxuICAgICAgZG9jLmNvbXBldGVuY2lhLFxyXG4gICAgICBkb2Mub3BvcnR1bmlkYWQsXHJcbiAgICAgIGRvYy5tYXNWZW5kaWRvLFxyXG4gICAgICBkb2MubWFzUHJlZ3VudGFuLFxyXG4gICAgICBkb2MuYXl1ZGFUaWVuZGEsXHJcbiAgICAgIGRvYy5ncHNTdGF0dXMsXHJcbiAgICAgIGRvYy5ncHNEaXN0YW5jZU0sXHJcbiAgICAgIGRvYy5pbnRlcmFjdGlvblR5cGUsXHJcbiAgICAgIGRvYy5mb3JtYUNvbnRhY3RvLFxyXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG8sXHJcbiAgICAgIGRvYy5jb250YWN0b1Jlc3VsdGFkb0F0LFxyXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG9CeSxcclxuICAgICAgZG9jLmNyZWF0ZWRBdCxcclxuICAgIF0sXHJcbiAgXTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDbGllbnRlUm93cyhkb2MpIHtcclxuICByZXR1cm4gW1xyXG4gICAgW1xyXG4gICAgICBkb2MuX2lkLFxyXG4gICAgICBkb2Mub3duZXJVaWQsXHJcbiAgICAgIGRvYy5vd25lckVtYWlsLFxyXG4gICAgICBkb2Mub3duZXJOYW1lLFxyXG4gICAgICBkb2MuY29tZXJjaW8sXHJcbiAgICAgIGRvYy5mYW50YXNpYSxcclxuICAgICAgZG9jLmN1aXQsXHJcbiAgICAgIGRvYy5jb25kaWNpb25GaXNjYWwsXHJcbiAgICAgIGRvYy5jYWxsZSxcclxuICAgICAgZG9jLm51bWVybyxcclxuICAgICAgZG9jLmxvY2FsaWRhZCxcclxuICAgICAgZG9jLnByb3ZpbmNpYSxcclxuICAgICAgZG9jLmxvY2FsaWRhZEZpbmFsLFxyXG4gICAgICBkb2MuY2FyZENvZGVTYXAsXHJcbiAgICAgIGRvYy5hc3NpZ25lZFZlbmRvcixcclxuICAgICAgZG9jLnN0YXR1cyxcclxuICAgICAgZG9jLnNvdXJjZSxcclxuICAgICAgZG9jLm1hbnVhbFNhcFBlbmRpbmcsXHJcbiAgICAgIGRvYy5wcmVjYXVjaW9uLFxyXG4gICAgICBkb2MuY2F0ZWdvcmlhQ2xpZW50ZSxcclxuICAgICAgZG9jLmNsaVRpcG8sXHJcbiAgICAgIGRvYy5sYXQsXHJcbiAgICAgIGRvYy5sbmcsXHJcbiAgICAgIGRvYy5sYXQgIT0gbnVsbCAmJiBkb2MubG5nICE9IG51bGwsXHJcbiAgICAgICEhKGRvYy5jYWxsZSB8fCBkb2MuYWRkcmVzcyksXHJcbiAgICAgIGRvYy5zdWJtaXR0ZWRCeVB1YmxpY0Zvcm0sXHJcbiAgICAgIGRvYy5hcHByb3ZlZEF0LFxyXG4gICAgICBkb2MuY3JlYXRlZEF0LFxyXG4gICAgICBkb2MudXBkYXRlZEF0LFxyXG4gICAgXSxcclxuICBdO1xyXG59XHJcblxyXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZENsaWVudE1hc3RlclJvd3MoZG9jKSB7XHJcbiAgcmV0dXJuIFtcclxuICAgIFtcclxuICAgICAgZG9jLl9pZCxcclxuICAgICAgZG9jLmNsaWVudE5hbWUsXHJcbiAgICAgIGRvYy5wcm92aW5jaWEsXHJcbiAgICAgIGRvYy5sb2NhbGlkYWQsXHJcbiAgICAgIGRvYy52ZW5kb3IsXHJcbiAgICAgIGRvYy5hZGRyZXNzLFxyXG4gICAgICBkb2Muc2FwQ2FyZENvZGUsXHJcbiAgICAgIGRvYy5zYXBBZGRyZXNzLFxyXG4gICAgICBkb2Muc2FwQ2l0eSxcclxuICAgICAgZG9jLnNhcFN0YXRlLFxyXG4gICAgICBkb2Muc2FwSW1wb3J0ZWRBdCxcclxuICAgICAgZG9jLnNhcEltcG9ydGVkQnksXHJcbiAgICAgIGRvYy5jbGllbnROYW1lT3JpZ2luYWwsXHJcbiAgICAgIGRvYy5sb2NhbGlkYWRPcmlnaW5hbCxcclxuICAgICAgZG9jLm1hdGNoVHlwZSxcclxuICAgICAgZG9jLm1hdGNoU2ltaWxhcml0eSxcclxuICAgICAgZG9jLnVwZGF0ZWRBdCxcclxuICAgICAgZG9jLnVwZGF0ZWRCeSxcclxuICAgIF0sXHJcbiAgXTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSZW5kaWNpb25Sb3dzKGRvYykge1xyXG4gIHJldHVybiBbXHJcbiAgICBbXHJcbiAgICAgIGRvYy5faWQsXHJcbiAgICAgIGRvYy5vd25lclVpZCxcclxuICAgICAgZG9jLm93bmVyRW1haWwsXHJcbiAgICAgIGRvYy52ZW5kb3IsXHJcbiAgICAgIGRvYy50aXBvLFxyXG4gICAgICBkb2MudGlwb0dhc3RvLFxyXG4gICAgICBkb2MuaW1wb3J0ZUFycyAhPSBudWxsID8gZG9jLmltcG9ydGVBcnMgOiBkb2MuaW1wb3J0ZSxcclxuICAgICAgZG9jLmZlY2hhR2FzdG8sXHJcbiAgICAgIGRvYy5jb25jZXB0byxcclxuICAgICAgLy8gZm90b1RpY2tldFVybCAodjMwOCspIHByaW9yaWRhZDsgTlVOQ0EgZXhwb3J0YXIgYmFzZTY0IGZvdG9UaWNrZXQgbGVnYWN5XHJcbiAgICAgIGRvYy5mb3RvVGlja2V0VXJsIHx8IG51bGwsXHJcbiAgICAgIGRvYy5zdGF0dXMsXHJcbiAgICAgIGRvYy5hcHByb3ZlZEJ5LFxyXG4gICAgICBkb2MuYXBwcm92ZWRBdCxcclxuICAgICAgZG9jLnJlamVjdGVkQnlFbWFpbCxcclxuICAgICAgZG9jLnJlamVjdGVkUmVhc29uLFxyXG4gICAgICBkb2MuYXBwcm92ZXJVaWQsXHJcbiAgICAgIGRvYy5jcmVhdGVkQXQsXHJcbiAgICBdLFxyXG4gIF07XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQ2FtcGFuaWFSb3dzKGRvYykge1xyXG4gIHJldHVybiBbXHJcbiAgICBbXHJcbiAgICAgIGRvYy5faWQsXHJcbiAgICAgIGRvYy5uYW1lLFxyXG4gICAgICBkb2MuZmFtaWxpYSxcclxuICAgICAgZG9jLnN1YmZhbWlsaWEsXHJcbiAgICAgIGRvYy5maWx0ZXJUeXBlLFxyXG4gICAgICBkb2MuZmlsdGVyVmFsdWVzLFxyXG4gICAgICBkb2Muc2t1cyxcclxuICAgICAgQXJyYXkuaXNBcnJheShkb2Muc2t1cykgPyBkb2Muc2t1cy5sZW5ndGggOiAwLFxyXG4gICAgICBkb2MudGFyZ2V0VHlwZSxcclxuICAgICAgZG9jLnRhcmdldEFtb3VudCxcclxuICAgICAgZG9jLnN0YXJ0RGF0ZSxcclxuICAgICAgZG9jLmVuZERhdGUsXHJcbiAgICAgIGRvYy5zY29wZSxcclxuICAgICAgZG9jLnNjb3BlVmFsdWVzLFxyXG4gICAgICBkb2MuY3JlYXRlZEJ5LFxyXG4gICAgICBkb2MuY3JlYXRlZEJ5RW1haWwsXHJcbiAgICAgIGRvYy5jcmVhdGVkQXQsXHJcbiAgICAgIGRvYy5hcmNoaXZlZE1hbnVhbGx5LFxyXG4gICAgICBkb2MuYXJjaGl2ZWRBdCxcclxuICAgICAgZG9jLmFyY2hpdmVkQnksXHJcbiAgICBdLFxyXG4gIF07XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVGFyZ2V0Um93cyhkb2MpIHtcclxuICByZXR1cm4gW1xyXG4gICAgW1xyXG4gICAgICBkb2MuX2lkLFxyXG4gICAgICBkb2Muc2VsbGVySWQsXHJcbiAgICAgIGRvYy55ZWFyLFxyXG4gICAgICBkb2MubW9udGgsXHJcbiAgICAgIGRvYy50YXJnZXRBcnMsXHJcbiAgICAgIGRvYy50YXJnZXRCeUZhbWlseSA/IGRvYy50YXJnZXRCeUZhbWlseS5SRUVMIDogbnVsbCxcclxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LkNBTkFTIDogbnVsbCxcclxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LkxJTkVBUyA6IG51bGwsXHJcbiAgICAgIGRvYy51cGRhdGVkQXQsXHJcbiAgICAgIGRvYy51cGRhdGVkQnksXHJcbiAgICAgIGRvYy51cGRhdGVkQnlFbWFpbCxcclxuICAgIF0sXHJcbiAgXTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWZW5kb3JPdmVycmlkZVJvd3MoZG9jKSB7XHJcbiAgcmV0dXJuIFtcclxuICAgIFtcclxuICAgICAgZG9jLl9pZCxcclxuICAgICAgZG9jLnNjb3BlLFxyXG4gICAgICBkb2MucHJvdmluY2UsXHJcbiAgICAgIGRvYy5sb2NhbGl0eU5hbWUsXHJcbiAgICAgIGRvYy5jbGllbnROYW1lLFxyXG4gICAgICBkb2Mub3JpZ2luYWxWZW5kb3IsXHJcbiAgICAgIGRvYy5uZXdWZW5kb3IsXHJcbiAgICAgIGRvYy5uZXdUeXBlLFxyXG4gICAgICBkb2MudXBkYXRlZEF0LFxyXG4gICAgICBkb2MudXBkYXRlZEJ5VWlkLFxyXG4gICAgICBkb2MudXBkYXRlZEJ5RW1haWwsXHJcbiAgICAgIGRvYy51cGRhdGVkQnlEaXNwbGF5TmFtZSxcclxuICAgIF0sXHJcbiAgXTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDdXN0b21Sb3V0ZVJvd3MoZG9jKSB7XHJcbiAgY29uc3QgaGVhZGVyID0gW1xyXG4gICAgZG9jLl9pZCxcclxuICAgIGRvYy5vd25lclVpZCxcclxuICAgIGRvYy5vd25lckVtYWlsLFxyXG4gICAgZG9jLm5hbWUsXHJcbiAgICBkb2MucGxhbm5lZERhdGUsXHJcbiAgICBkb2Mubm90ZXMsXHJcbiAgICBkb2MuY3JlYXRlZEF0LFxyXG4gICAgZG9jLnVwZGF0ZWRBdCxcclxuICBdO1xyXG4gIGNvbnN0IHN0b3BzID0gQXJyYXkuaXNBcnJheShkb2Muc3RvcHMpID8gZG9jLnN0b3BzIDogW107XHJcbiAgaWYgKCFzdG9wcy5sZW5ndGgpIHtcclxuICAgIHJldHVybiBbaGVhZGVyLmNvbmNhdChbbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbF0pXTtcclxuICB9XHJcbiAgcmV0dXJuIHN0b3BzLm1hcCgoLyoqIEB0eXBlIHthbnl9ICovIHMpID0+XHJcbiAgICBoZWFkZXIuY29uY2F0KFtcclxuICAgICAgcyA/IHMub3JkZXIgOiBudWxsLFxyXG4gICAgICBzID8gcy5rZXkgOiBudWxsLFxyXG4gICAgICBzID8gcy50aXBvIDogbnVsbCxcclxuICAgICAgcyA/IHMucHJvdmluY2lhIDogbnVsbCxcclxuICAgICAgcyA/IHMubG9jYWxpZGFkIDogbnVsbCxcclxuICAgICAgcyA/IHMuY2xpZW50TmFtZSA6IG51bGwsXHJcbiAgICAgIHMgPyBzLmlzUHJvdmlzb3JpbyA6IG51bGwsXHJcbiAgICAgIHMgPyBzLnNhcEFsdGFJZCA6IG51bGwsXHJcbiAgICBdKVxyXG4gICk7XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2VndWltaWVudG9Ob3RlUm93cyhkb2MpIHtcclxuICByZXR1cm4gW1xyXG4gICAgW1xyXG4gICAgICBkb2MuX2lkLFxyXG4gICAgICBkb2MudmVuZG9yRXh0LFxyXG4gICAgICBkb2MuY2xpZW50S2V5LFxyXG4gICAgICBkb2MuY2xpZW50TmFtZSxcclxuICAgICAgZG9jLnByb3ZpbmNlLFxyXG4gICAgICBkb2MubG9jYWxpdHksXHJcbiAgICAgIGRvYy50ZXh0LFxyXG4gICAgICBkb2MuYXV0aG9yVWlkLFxyXG4gICAgICBkb2MuYXV0aG9yRW1haWwsXHJcbiAgICAgIGRvYy5hdXRob3JOYW1lLFxyXG4gICAgICBkb2MuYXV0aG9yUm9sZSxcclxuICAgICAgZG9jLmNyZWF0ZWRBdCxcclxuICAgIF0sXHJcbiAgXTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFByb2R1Y3RvcyBkZXNkZSBzdG9jay5qc29uIChmb3JtYXRvIFNoaW1hbm86IHtzdG9jazoge1NLVTogYm9vbCwgLi4ufSxcclxuICogcXVhbnRpdGllczogSlNPTiBzdHJpbmcsIHdhcmVob3VzZUJyZWFrZG93bjogSlNPTiBzdHJpbmcsIHVwZGF0ZWRBdDogLi4ufSkuXHJcbiAqIEBwYXJhbSB7b2JqZWN0fSBzdG9ja0pzb25cclxuICogQHJldHVybnMge3Vua25vd25bXVtdfVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUHJvZHVjdG9Sb3dzRnJvbVN0b2NrSnNvbihzdG9ja0pzb24pIHtcclxuICBjb25zdCBzaiA9IC8qKiBAdHlwZSB7YW55fSAqLyAoc3RvY2tKc29uKSB8fCB7fTtcclxuICBjb25zdCBzdG9ja01hcCA9IHNqLnN0b2NrIHx8IHt9O1xyXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cclxuICBsZXQgcXVhbnRpdGllcyA9IHt9O1xyXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgbnVtYmVyPj59ICovXHJcbiAgbGV0IGJyZWFrZG93biA9IHt9O1xyXG4gIHRyeSB7XHJcbiAgICBxdWFudGl0aWVzID0gc2oucXVhbnRpdGllcyA/IEpTT04ucGFyc2Uoc2oucXVhbnRpdGllcykgOiBzai5xdWFudGl0aWVzX21hcCB8fCB7fTtcclxuICB9IGNhdGNoIChfKSB7fVxyXG4gIHRyeSB7XHJcbiAgICBicmVha2Rvd24gPSBzai53YXJlaG91c2VCcmVha2Rvd25cclxuICAgICAgPyBKU09OLnBhcnNlKHNqLndhcmVob3VzZUJyZWFrZG93bilcclxuICAgICAgOiBzai53YXJlaG91c2VCcmVha2Rvd25fbWFwIHx8IHt9O1xyXG4gIH0gY2F0Y2ggKF8pIHt9XHJcbiAgY29uc3Qgcm93cyA9IC8qKiBAdHlwZSB7dW5rbm93bltdW119ICovIChbXSk7XHJcbiAgY29uc3Qgc291cmNlID0gJ3N0b2NrLmpzb24gc25hcHNob3QnO1xyXG4gIGNvbnN0IHVwZGF0ZWRBdCA9IHNqLnVwZGF0ZWRBdCB8fCBzai5zbmFwc2hvdEF0IHx8IG51bGw7XHJcbiAgZm9yIChjb25zdCBza3Ugb2YgT2JqZWN0LmtleXMoc3RvY2tNYXApKSB7XHJcbiAgICBjb25zdCBoYXNfc3RvY2sgPSAhIXN0b2NrTWFwW3NrdV07XHJcbiAgICBjb25zdCB0b3RhbCA9IE51bWJlcihxdWFudGl0aWVzW3NrdV0gfHwgMCk7XHJcbiAgICBjb25zdCB3YnMgPSBicmVha2Rvd25bc2t1XSB8fCB7fTtcclxuICAgIGNvbnN0IHcxMSA9IE51bWJlcih3YnNbJzExJ10gfHwgMCk7XHJcbiAgICBjb25zdCB3MTIgPSBOdW1iZXIod2JzWycxMiddIHx8IDApO1xyXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xyXG4gICAgY29uc3Qgb3Ryb3MgPSB7fTtcclxuICAgIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyh3YnMpKSB7XHJcbiAgICAgIGlmIChrICE9PSAnMTEnICYmIGsgIT09ICcxMicpIG90cm9zW2tdID0gTnVtYmVyKHdic1trXSB8fCAwKTtcclxuICAgIH1cclxuICAgIHJvd3MucHVzaChbXHJcbiAgICAgIHNrdSxcclxuICAgICAgaGFzX3N0b2NrLFxyXG4gICAgICB0b3RhbCxcclxuICAgICAgdzExLFxyXG4gICAgICB3MTIsXHJcbiAgICAgIE9iamVjdC5rZXlzKG90cm9zKS5sZW5ndGggPyBvdHJvcyA6IG51bGwsXHJcbiAgICAgIHNvdXJjZSxcclxuICAgICAgdXBkYXRlZEF0LFxyXG4gICAgXSk7XHJcbiAgfVxyXG4gIHJldHVybiByb3dzO1xyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRGlzcGF0Y2hlcjogbWFwYSBjb2xsZWN0aW9uIC0+IHJvdyBidWlsZGVyXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuLy8gdjczMjogYnVpbGRlcnMgcGFyYSBsb3MgMyBzbmFwc2hvdHMgQlEtPkZpcmVzdG9yZS5cclxuXHJcbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2FwU25hcHNob3RSb3dzKGRvYykge1xyXG4gIHJldHVybiBbXHJcbiAgICBbXHJcbiAgICAgIGRvYy5faWQsXHJcbiAgICAgIGRvYy52ZW5kb3JLZXksXHJcbiAgICAgIGRvYy5hbmlvLFxyXG4gICAgICBkb2MubWVzLFxyXG4gICAgICBkb2MuZmFjdHVyYWRvQXJzTmV0byxcclxuICAgICAgZG9jLmZhY3R1cmFkb0Fyc0JydXRvLFxyXG4gICAgICBkb2MubmNzQXJzLFxyXG4gICAgICBkb2MuZmFjdHVyYXNDb3VudCxcclxuICAgICAgZG9jLm5jc0NvdW50LFxyXG4gICAgICBkb2MudW5pZGFkZXNOZXRvLFxyXG4gICAgICBkb2MuaW1wb3J0ZUxpbmVhc0Fyc05ldG8sXHJcbiAgICAgIGRvYy51cGRhdGVkQXQsXHJcbiAgICBdLFxyXG4gIF07XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkRmFjdHVyYWNpb25TbmFwc2hvdFJvd3MoZG9jKSB7XHJcbiAgcmV0dXJuIFtbZG9jLl9pZCwgZG9jLnZlbmRvcktleSwgZG9jLmhveUFycywgZG9jLm1lc0FycywgZG9jLmFub0FycywgZG9jLnVwZGF0ZWRBdF1dO1xyXG59XHJcblxyXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZEJhY2tvcmRlclNuYXBzaG90Um93cyhkb2MpIHtcclxuICBjb25zdCBoZWFkZXIgPSBbZG9jLl9pZCwgZG9jLnZlbmRvcktleSwgZG9jLmxpbmVzQ291bnQsIGRvYy51cGRhdGVkQXRdO1xyXG4gIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShkb2MubGluZXMpID8gZG9jLmxpbmVzIDogW107XHJcbiAgaWYgKCFsaW5lcy5sZW5ndGgpIHtcclxuICAgIHJldHVybiBbXHJcbiAgICAgIGhlYWRlci5jb25jYXQoW1xyXG4gICAgICAgIG51bGwsXHJcbiAgICAgICAgbnVsbCxcclxuICAgICAgICBudWxsLFxyXG4gICAgICAgIG51bGwsXHJcbiAgICAgICAgbnVsbCxcclxuICAgICAgICBudWxsLFxyXG4gICAgICAgIG51bGwsXHJcbiAgICAgICAgbnVsbCxcclxuICAgICAgICBudWxsLFxyXG4gICAgICAgIG51bGwsXHJcbiAgICAgICAgbnVsbCxcclxuICAgICAgICBudWxsLFxyXG4gICAgICAgIG51bGwsXHJcbiAgICAgICAgbnVsbCxcclxuICAgICAgXSksXHJcbiAgICBdO1xyXG4gIH1cclxuICByZXR1cm4gbGluZXMubWFwKCgvKiogQHR5cGUge2FueX0gKi8gbCkgPT5cclxuICAgIGhlYWRlci5jb25jYXQoW1xyXG4gICAgICBsID8gbC5za3UgOiBudWxsLFxyXG4gICAgICBsID8gbC5wcm9kdWN0byA6IG51bGwsXHJcbiAgICAgIGwgPyBsLmZhbWlsaWEgOiBudWxsLFxyXG4gICAgICBsID8gbC5zdWJmYW1pbGlhIDogbnVsbCxcclxuICAgICAgbCA/IGwucGVuZGllbnRlIDogbnVsbCxcclxuICAgICAgbCA/IGwucGVkaWRvIDogbnVsbCxcclxuICAgICAgbCA/IGwuc3RvY2tBY3R1YWwgOiBudWxsLFxyXG4gICAgICBsID8gbC5wcmVjaW9Vbml0YXJpbyA6IG51bGwsXHJcbiAgICAgIGwgPyBsLmNsaWVudGVDb2RlIDogbnVsbCxcclxuICAgICAgbCA/IGwuY2xpZW50ZU5vbWJyZSA6IG51bGwsXHJcbiAgICAgIGwgPyBsLmNsaWVudGVDaXVkYWQgOiBudWxsLFxyXG4gICAgICBsID8gbC5zcURvY051bSA6IG51bGwsXHJcbiAgICAgIGwgPyBsLnNxRG9jRGF0ZSA6IG51bGwsXHJcbiAgICAgIGwgPyBsLmVzdGFkbyA6IG51bGwsXHJcbiAgICBdKVxyXG4gICk7XHJcbn1cclxuXHJcbi8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKGRvYzogYW55KSA9PiB1bmtub3duW11bXT59ICovXHJcbmV4cG9ydCBjb25zdCBST1dfQlVJTERFUlMgPSB7XHJcbiAgcGVkaWRvczogYnVpbGRQZWRpZG9Sb3dzLFxyXG4gIHZpc2l0YXM6IGJ1aWxkVmlzaXRhUm93cyxcclxuICBjbGllbnRlczogYnVpbGRDbGllbnRlUm93cyxcclxuICBjbGllbnRfbWFzdGVyOiBidWlsZENsaWVudE1hc3RlclJvd3MsXHJcbiAgcmVuZGljaW9uZXM6IGJ1aWxkUmVuZGljaW9uUm93cyxcclxuICBjYW1wYW5pYXM6IGJ1aWxkQ2FtcGFuaWFSb3dzLFxyXG4gIHRhcmdldHM6IGJ1aWxkVGFyZ2V0Um93cyxcclxuICB2ZW5kb3Jfb3ZlcnJpZGVzOiBidWlsZFZlbmRvck92ZXJyaWRlUm93cyxcclxuICBjdXN0b21fcm91dGVzOiBidWlsZEN1c3RvbVJvdXRlUm93cyxcclxuICBzZWd1aW1pZW50b19ub3RlczogYnVpbGRTZWd1aW1pZW50b05vdGVSb3dzLFxyXG4gIC8vIHY3MzI6IDMgc25hcHNob3RzIEJRLT5GaXJlc3RvcmUuXHJcbiAgc2FwX3NuYXBzaG90OiBidWlsZFNhcFNuYXBzaG90Um93cyxcclxuICBmYWN0dXJhY2lvbl9zbmFwc2hvdDogYnVpbGRGYWN0dXJhY2lvblNuYXBzaG90Um93cyxcclxuICBiYWNrb3JkZXJfc25hcHNob3Q6IGJ1aWxkQmFja29yZGVyU25hcHNob3RSb3dzLFxyXG59O1xyXG4iLCAiLy8gQHRzLW5vY2hlY2tcbi8vIEVYUE9SVFMtQURWQU5DRUQ6IHBob3RvIFpJUHMsIGF1ZGl0IFhMU1gsIGV4ZWN1dGl2ZSBzdW1tYXJ5LCB2aXNpdHMgWExTWCxcbi8vIFBvd2VyQkkgZGF0YXNldCwgTUwgZGF0YXNldC4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICg0IGZyYWdtZW50b3Ncbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIEJhY2t1cCArIEF1ZGl0ICsgX2V4cG9ydExlZ2FjeUZ1bGwgcXVlIHF1ZWRhblxuLy8gZW4gZWwgaW5saW5lKSBjb21vIHBhcnRlIGRlIEUyLm4uMiAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuXG4vL1xuLy8gdjM3MSs6IGV4cG9ydERhdGFzZXRaaXAoKSBudWV2byBcdTIwMTQgWklQIGNvbiBDU1ZzIHBvciBlbnRpZGFkIHBhcmEgcGlwZWxpbmVzXG4vLyBNTCBleHRlcm5vcyAoTWljcm9zb2Z0IEZhYnJpYykuIEltcG9ydGEgbG9zIGhlbHBlcnMgcHVyb3MgeSBzY2hlbWFzIGRlbFxuLy8gbW9kdWxvIHNyYy9wdXJlL2Nzdi1zZXJpYWxpemVyLmpzLiBWZXIgcGxhbiBjb3NtaWMtcG9uZGVyaW5nLXN0ZWFybnMubWQuXG5cbmltcG9ydCB7XG4gIGJ1aWxkQ3N2LFxuICBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24sXG4gIGNvbXB1dGVOdWxsUmF0ZXMsXG4gIERBVEFTRVRfU0NIRU1BUyxcbiAgREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVgsXG4gIFJPV19CVUlMREVSUyxcbn0gZnJvbSAnLi4vcHVyZS9jc3Ytc2VyaWFsaXplci5qcyc7XG5cbi8vXG4vLyBEZXBzIGRlbCBpbmxpbmU6IEpTWmlwIChDRE4gbGF6eSksIEV4Y2VsSlMgKENETiBsYXp5IHZpYSBsb2FkRXhjZWxKUyksXG4vLyBYTFNYIChkZWZlciBlbiBoZWFkKSwgdmlzaXRzQ2FjaGUsIGNhbXBhaWduc0NhY2hlLCBvcHNMb2dDYWNoZSAoYXVkaXRcbi8vIGlubGluZSksIGF1ZGl0TG9nQ2FjaGUgKGF1ZGl0IGlubGluZSksIGNvbnRhY3RlZCAoZ2xvYmFsIFNldCksIFBPSU5UUyxcbi8vIFBST0RVQ1RTLCBWRU5ET1JTLCBNRVNFUywgdmVuZG9yTG9va3VwLCBlc2NhcGVIdG1sLCBlc2NhcGVBdHRyLCB0aXRsZUNhc2UsXG4vLyBzaG93U3luY1RhZywgY3VycmVudFVzZXIsIHVzZXJSb2xlLCBvcmRlcnMsIGNvbmZpcm1lZCwgcGVuZGluZy5cbi8vXG4vLyBDcm9zcy1zY29wZSBzdGF0ZTogTk9ORSAodG9kb3MgbG9zIGhlbHBlcnMgeSBjb25zdHMgbG9jYWxlcyBhbCBibG9xdWUpLlxuLy8gU2luIGxpc3RlbmVycyBvblNuYXBzaG90LlxuLy9cbi8vIE5PVEE6IGxvcyBoZWxwZXJzIHRvZGF5U3RyL2RhdGFVcmxUb0Jsb2Ivc2FuaXRpemVGb3JQYXRoIHZpdmVuIGVuIGVzdGVcbi8vIG1cdTAwRjNkdWxvIFx1MjAxNCBlbCBpbmxpbmUgcHVlZGUgbGxhbWFybG9zIHZpYSBmcmVlIHJlZmVyZW5jZSBhbCBHbG9iYWwgRW52aXJvbm1lbnRcbi8vIFJlY29yZCBwZXJvIHByZWZlcmltb3MgZXhwb3NpY2lcdTAwRjNuIHdpbmRvdy4qIGV4cGxcdTAwRURjaXRhIGFsIGZpbmFsLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDQ0lcdTAwRDNOOiBoZWxwZXJzICsgcGhvdG9zIHppcCArIHZpc2l0cyBlbWJlZGRlZCAoaW5saW5lIEw5MjU2LTk0NDUpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZnVuY3Rpb24gdG9kYXlTdHIoKSB7XG4gIHJldHVybiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xufVxuXG4vLyBIZWxwZXI6IGNvbnZlcnRpciBkYXRhVVJMIGJhc2U2NCBhIEJsb2IgcGFyYSBpbmNsdWlyIGVuIFpJUFxuZnVuY3Rpb24gZGF0YVVybFRvQmxvYihkYXRhVXJsKSB7XG4gIGlmICghZGF0YVVybCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhcnRzID0gZGF0YVVybC5zcGxpdCgnLCcpO1xuICBpZiAocGFydHMubGVuZ3RoIDwgMikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG1pbWVNYXRjaCA9IHBhcnRzWzBdLm1hdGNoKC86KC4qPyk7Lyk7XG4gIGNvbnN0IG1pbWUgPSBtaW1lTWF0Y2ggPyBtaW1lTWF0Y2hbMV0gOiAnaW1hZ2UvanBlZyc7XG4gIGNvbnN0IGJ5dGVzID0gYXRvYihwYXJ0c1sxXSk7XG4gIGNvbnN0IGFyciA9IG5ldyBVaW50OEFycmF5KGJ5dGVzLmxlbmd0aCk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpKyspIGFycltpXSA9IGJ5dGVzLmNoYXJDb2RlQXQoaSk7XG4gIHJldHVybiBuZXcgQmxvYihbYXJyXSwgeyB0eXBlOiBtaW1lIH0pO1xufVxuXG4vLyBTYW5lYXIgbm9tYnJlcyBwYXJhIHF1ZSBzaXJ2YW4gY29tbyBydXRhIGRlIGFyY2hpdm9cbmZ1bmN0aW9uIHNhbml0aXplRm9yUGF0aChzKSB7XG4gIHJldHVybiBTdHJpbmcocyB8fCAnJylcbiAgICAucmVwbGFjZSgvW1xcXFwvKj9bXFxdOnxcIjw+XS9nLCAnXycpXG4gICAgLnJlcGxhY2UoL1xccysvZywgJyAnKVxuICAgIC50cmltKClcbiAgICAuc2xpY2UoMCwgNjApO1xufVxuXG4vLyBEZXNjYXJnYXIgdG9kYXMgbGFzIGZvdG9zIGRlIHZpc2l0YXMgZW4gdW4gWklQIG9yZ2FuaXphZG8gcG9yIHZlbmRlZG9yIC8gdGllbmRhIC8gZmVjaGFcbndpbmRvdy5leHBvcnRQaG90b3NaaXAgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIC8vIHY2NzkgUEVSRiBGYXNlIDM6IEpTWmlwIGxhenkgb24tZGVtYW5kXG4gIHRyeSB7XG4gICAgYXdhaXQgd2luZG93LmxvYWRKU1ppcCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ05vIHNlIHB1ZG8gY2FyZ2FyIEpTWmlwOiAnICsgZS5tZXNzYWdlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCF2aXNpdHNDYWNoZSB8fCAhdmlzaXRzQ2FjaGUubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgcGhvdG9Db3VudCA9IDA7XG4gIGNvbnN0IHppcCA9IG5ldyBKU1ppcCgpO1xuICB2aXNpdHNDYWNoZS5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgdmVuZG9yID0gc2FuaXRpemVGb3JQYXRoKHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnU0lOX1ZFTkRFRE9SJykpO1xuICAgIGNvbnN0IHRpZW5kYSA9IHNhbml0aXplRm9yUGF0aCh2LnRpZW5kYSB8fCAnc2luX3RpZW5kYScpO1xuICAgIGNvbnN0IGZlY2hhID0gKHYuZmVjaGEgfHwgJycpLnJlcGxhY2UoLy0vZywgJycpO1xuICAgIGNvbnN0IGZvbGRlck5hbWUgPSB2ZW5kb3IgKyAnLycgKyB0aWVuZGEgKyAnXycgKyBmZWNoYTtcbiAgICBjb25zdCBmb2xkZXIgPSB6aXAuZm9sZGVyKGZvbGRlck5hbWUpO1xuICAgIGlmICh2LmZyZW50ZUxvY2FsKSB7XG4gICAgICBjb25zdCBiID0gZGF0YVVybFRvQmxvYih2LmZyZW50ZUxvY2FsKTtcbiAgICAgIGlmIChiKSB7XG4gICAgICAgIGZvbGRlci5maWxlKCdmcmVudGUuanBnJywgYik7XG4gICAgICAgIHBob3RvQ291bnQrKztcbiAgICAgIH1cbiAgICB9XG4gICAgKHYuZXNwYWNpbyB8fCBbXSkuZm9yRWFjaCgoYjY0LCBpKSA9PiB7XG4gICAgICBjb25zdCBiID0gZGF0YVVybFRvQmxvYihiNjQpO1xuICAgICAgaWYgKGIpIHtcbiAgICAgICAgZm9sZGVyLmZpbGUoJ2VzcGFjaW9fJyArIChpICsgMSkgKyAnLmpwZycsIGIpO1xuICAgICAgICBwaG90b0NvdW50Kys7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuICBpZiAoIXBob3RvQ291bnQpIHtcbiAgICBhbGVydCgnTm8gaGF5IGZvdG9zIGNhcmdhZGFzIGVuIGxhcyB2aXNpdGFzLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIFpJUCBkZSAnICsgcGhvdG9Db3VudCArICcgZm90b3MuLi4nLCAzMDAwMCk7XG4gIHRyeSB7XG4gICAgY29uc3QgYmxvYiA9IGF3YWl0IHppcC5nZW5lcmF0ZUFzeW5jKHsgdHlwZTogJ2Jsb2InLCBjb21wcmVzc2lvbjogJ0RFRkxBVEUnIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX0ZvdG9zX1Zpc2l0YXNfJyArIHRvZGF5U3RyKCkgKyAnLnppcCc7XG4gICAgYS5jbGljaygpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcbiAgICBzaG93U3luY1RhZyhwaG90b0NvdW50ICsgJyBmb3RvcyBkZXNjYXJnYWRhcycsIDMwMDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignemlwJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBaSVA6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeGNlbCBjb24gZm90b3MgZGVsIGZyZW50ZSBlbWJlYmlkYXMgZW4gY2FkYSBjZWxkYSAoRXhjZWxKUylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhjZWxKUyBzZSBjYXJnYSBsYXp5IChzb2xvIGN1YW5kbyBzZSB0b2NhIGVsIGJvdG9uKSBwYXJhIG5vIGluZmxhciBlbCBidW5kbGUuXG5mdW5jdGlvbiBsb2FkRXhjZWxKUygpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBpZiAodHlwZW9mIEV4Y2VsSlMgIT09ICd1bmRlZmluZWQnKSByZXR1cm4gcmVzb2x2ZSgpO1xuICAgIGNvbnN0IHMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKTtcbiAgICBzLnNyYyA9ICdodHRwczovL2Nkbi5qc2RlbGl2ci5uZXQvbnBtL2V4Y2VsanNANC40LjAvZGlzdC9leGNlbGpzLm1pbi5qcyc7XG4gICAgcy5vbmxvYWQgPSAoKSA9PiByZXNvbHZlKCk7XG4gICAgcy5vbmVycm9yID0gKCkgPT5cbiAgICAgIHJlamVjdChuZXcgRXJyb3IoJ05vIHNlIHB1ZG8gY2FyZ2FyIGxhIGxpYnJlcmlhIEV4Y2VsSlMuIFJldmlzYSB0dSBjb25leGlvbiBhIGludGVybmV0LicpKTtcbiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHMpO1xuICB9KTtcbn1cblxud2luZG93LmV4cG9ydFZpc2l0c1dpdGhFbWJlZGRlZFBob3RvcyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCF2aXNpdHNDYWNoZSB8fCAhdmlzaXRzQ2FjaGUubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBuID0gdmlzaXRzQ2FjaGUubGVuZ3RoO1xuICBpZiAobiA+IDMwMCkge1xuICAgIGlmIChcbiAgICAgICFjb25maXJtKFxuICAgICAgICAnSGF5ICcgK1xuICAgICAgICAgIG4gK1xuICAgICAgICAgICcgdmlzaXRhcy4gRWwgRXhjZWwgY29uIHRvZGFzIGxhcyBmb3RvcyBlbWJlYmlkYXMgcHVlZGUgcGVzYXIgNTAtMTUwIE1CIHkgdGFyZGFyIHZhcmlvcyBtaW51dG9zLiBcdTAwQkZDb250aW51YXI/J1xuICAgICAgKVxuICAgIClcbiAgICAgIHJldHVybjtcbiAgfSBlbHNlIGlmIChuID4gMTAwKSB7XG4gICAgaWYgKFxuICAgICAgIWNvbmZpcm0oXG4gICAgICAgICdWYXMgYSBnZW5lcmFyIHVuIEV4Y2VsIGNvbiAnICtcbiAgICAgICAgICBuICtcbiAgICAgICAgICAnIHZpc2l0YXMgeSBzdXMgZm90b3MgZW1iZWJpZGFzLiBQdWVkZSB0YXJkYXIgMzAtNjAgc2VndW5kb3MuIFx1MDBCRkNvbnRpbnVhcj8nXG4gICAgICApXG4gICAgKVxuICAgICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdDYXJnYW5kbyBFeGNlbEpTLi4uJywgMjAwMCk7XG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGNvbiAnICsgbiArICcgdmlzaXRhcy4uLicsIDMwMDApO1xuXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdWaXNpdGFzJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XG5cbiAgLy8gRGVmaW5pY2lvbiBkZSBjb2x1bW5hcy4gTGEgY29sdW1uYSBkZSBmb3RvIHZhIGEgdGVuZXIgYW5jaG8gZXh0cmEgcGFyYSBxdWUgc2UgdmVhLlxuICB3cy5jb2x1bW5zID0gW1xuICAgIHsgaGVhZGVyOiAnRmVjaGEnLCBrZXk6ICdmZWNoYScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTWVzJywga2V5OiAnbWVzJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvIGNvbnRhY3RvJywga2V5OiAndGlwb0N0Jywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdDb21lbnRhcmlvJywga2V5OiAnY29tZW50Jywgd2lkdGg6IDMyIH0sXG4gICAgeyBoZWFkZXI6ICdQcm92aW5jaWEnLCBrZXk6ICdwcm92aW5jaWEnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ0xvY2FsaWRhZCcsIGtleTogJ2xvY2FsaWRhZCcsIHdpZHRoOiAxOCB9LFxuICAgIHsgaGVhZGVyOiAnVGllbmRhJywga2V5OiAndGllbmRhJywgd2lkdGg6IDMwIH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTG9jYWwnLCBrZXk6ICdsb2NhbCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnVGFtYW5vJywga2V5OiAndGFtYW5vJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdGaWRlbGlkYWQnLCBrZXk6ICdmaWRlbGlkYWQnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1JlbGV2YW5jaWEnLCBrZXk6ICdyZWxldicsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUE9QJywga2V5OiAncG9wJywgd2lkdGg6IDggfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gdmVudGEnLCBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0NvbXBldGVuY2lhJywga2V5OiAnY29tcGUnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ09wb3J0dW5pZGFkJywga2V5OiAnb3BvcnR1Jywgd2lkdGg6IDMwIH0sXG4gICAgeyBoZWFkZXI6ICdMbyBtYXMgdmVuZGlkbycsIGtleTogJ21hc1ZlJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdHUFMgZGlzdCAobSknLCBrZXk6ICdncHNEaXN0Jywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdGb3RvIGZyZW50ZScsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSwgLy8gPC0gbGEgaW1hZ2VuIHZhIGFjYVxuICAgIHsgaGVhZGVyOiAnRW1haWwgdmVuZGVkb3InLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxuICBdO1xuXG4gIC8vIEVzdGlsbyBoZWFkZXJcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjBDNEE2RScgfSB9O1xuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcblxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxOyAvLyAwLWluZGV4ZWQgcGFyYSBhZGRJbWFnZVxuICBjb25zdCBST1dfSCA9IDEwMDtcbiAgY29uc3QgSU1HX1cgPSAxMzA7XG4gIGNvbnN0IElNR19IID0gOTA7XG5cbiAgLy8gT3JkZW5hciB2aXNpdGFzIHBvciBmZWNoYSBkZXNjIChtYXMgcmVjaWVudGVzIHByaW1lcm8pXG4gIGNvbnN0IHNvcnRlZCA9IHZpc2l0c0NhY2hlLnNsaWNlKCkuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xuXG4gIGZvciAoY29uc3QgdiBvZiBzb3J0ZWQpIHtcbiAgICBjb25zdCB0aXBvQ29udGFjdG9MYmwgPSB2LnRpcG9Db250YWN0byA9PT0gJ3RlbGVmb25vJyA/ICdUZWxlZm9ubycgOiAnUHJlc2VuY2lhbCc7XG4gICAgY29uc3QgciA9IHdzLmFkZFJvdyh7XG4gICAgICBmZWNoYTogdi5mZWNoYSB8fCAnJyxcbiAgICAgIG1lczogdi5tZXMgfHwgJycsXG4gICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcbiAgICAgIHRpcG9DdDogdGlwb0NvbnRhY3RvTGJsLFxuICAgICAgY29tZW50OiB2LmNvbWVudGFyaW8gfHwgJycsXG4gICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZSh2LnByb3ZpbmNpYSB8fCAnJyksXG4gICAgICBsb2NhbGlkYWQ6IHYubG9jYWxpZGFkIHx8ICcnLFxuICAgICAgdGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcbiAgICAgIHRpcG86IHYudGlwbyB8fCAnJyxcbiAgICAgIGxvY2FsOiB2LmxvY2FsIHx8ICcnLFxuICAgICAgdGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcbiAgICAgIGZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXG4gICAgICByZWxldjogdi5yZWxldmFuY2lhIHx8ICcnLFxuICAgICAgcG9wOiB2LnBvcCB8fCAnJyxcbiAgICAgIHRpcG9WZW50YTogdi50aXBvVmVudGEgPT09ICdNT1NUUkFETycgPyAnTU9TVFJBRE9SJyA6IHYudGlwb1ZlbnRhIHx8ICcnLFxuICAgICAgY29tcGU6IHYuY29tcGV0ZW5jaWEgfHwgJycsXG4gICAgICBvcG9ydHU6IHYub3BvcnR1bmlkYWQgfHwgJycsXG4gICAgICBtYXNWZTogdi5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgZ3BzRGlzdDogdHlwZW9mIHYuZ3BzRGlzdGFuY2VNID09PSAnbnVtYmVyJyA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXG4gICAgICBmb3RvOiAnJywgLy8gbGEgY2VsZGEgcXVlZGEgdmFjaWE7IGVuY2ltYSB2YSBsYSBpbWFnZW5cbiAgICAgIGVtYWlsOiB2Lm93bmVyRW1haWwgfHwgJycsXG4gICAgfSk7XG4gICAgci5oZWlnaHQgPSBST1dfSDtcbiAgICByLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIGlmICh2LmZyZW50ZUxvY2FsICYmIHR5cGVvZiB2LmZyZW50ZUxvY2FsID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gRWwgY2FtcG8gZXMgdW4gZGF0YVVSTDogJ2RhdGE6aW1hZ2UvanBlZztiYXNlNjQsLzlqLzRBQVEuLi4nXG4gICAgICAgIGxldCBiNjQgPSB2LmZyZW50ZUxvY2FsO1xuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcbiAgICAgICAgaWYgKG0pIHtcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgYjY0ID0gbVsyXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHQgfSk7XG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByLm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byBmaWxhJywgci5udW1iZXIsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEdlbmVyYXIgeSBkZXNjYXJnYXJcbiAgdHJ5IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1Zpc2l0YXNfY29uX2ZvdG9zXycgKyB0b2RheVN0cigpICsgJy54bHN4JztcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcbiAgICBzaG93U3luY1RhZygnRXhjZWwgZGVzY2FyZ2FkbzogJyArIHNvcnRlZC5sZW5ndGggKyAnIHZpc2l0YXMnLCAzMDAwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFZpc2l0c1dpdGhFbWJlZGRlZFBob3RvcycsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ0NJXHUwMEQzTjogZXhwb3J0QXVkaXRFeGNlbCAoaW5saW5lIEwxMDA0MC0xMDA2Nylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG53aW5kb3cuZXhwb3J0QXVkaXRFeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgaXRlbXMgPSBnZXRGaWx0ZXJlZEF1ZGl0RW50cmllcygpO1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgZXZlbnRvcyBwYXJhIGV4cG9ydGFyIGNvbiBsb3MgZmlsdHJvcyBhcGxpY2Fkb3MuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBpdGVtcy5tYXAoKGUpID0+IHtcbiAgICBjb25zdCB0cyA9IGUudGltZXN0YW1wICYmIGUudGltZXN0YW1wLnRvRGF0ZSA/IGUudGltZXN0YW1wLnRvRGF0ZSgpIDogbnVsbDtcbiAgICByZXR1cm4ge1xuICAgICAgRmVjaGFfSG9yYTogdHMgPyB0cy50b0lTT1N0cmluZygpLnJlcGxhY2UoJ1QnLCAnICcpLnNsaWNlKDAsIDE5KSA6ICcnLFxuICAgICAgVXN1YXJpb19FbWFpbDogZS51c2VyRW1haWwgfHwgJycsXG4gICAgICBVc3VhcmlvX1VJRDogZS51c2VyVWlkIHx8ICcnLFxuICAgICAgUm9sOiBlLnVzZXJSb2xlIHx8ICcnLFxuICAgICAgQWNjaW9uOiBBVURJVF9BQ1RJT05fTEFCRUxTW2UuYWN0aW9uXSB8fCBlLmFjdGlvbiB8fCAnJyxcbiAgICAgIEFjY2lvbl9SYXc6IGUuYWN0aW9uIHx8ICcnLFxuICAgICAgVGlwb19FbnRpZGFkOiBlLmVudGl0eVR5cGUgfHwgJycsXG4gICAgICBFbnRpZGFkOiBlLmVudGl0eU5hbWUgfHwgJycsXG4gICAgICBEZXRhbGxlc19KU09OOiBlLmRldGFpbHMgPyBKU09OLnN0cmluZ2lmeShlLmRldGFpbHMpIDogJycsXG4gICAgfTtcbiAgfSk7XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDMwIH0sXG4gICAgeyB3Y2g6IDMwIH0sXG4gICAgeyB3Y2g6IDEwIH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gICAgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDQwIH0sXG4gICAgeyB3Y2g6IDYwIH0sXG4gIF07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnQXVkaXRvcmlhJyk7XG4gIGNvbnN0IHN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX0F1ZGl0b3JpYV8nICsgc3RhbXAgKyAnLnhsc3gnKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTRUNDSVx1MDBEM046IGJ1aWxkQ29udGFjdGFkb3NSb3dzL09wc0xvZy9WaXNpdCAoaW5saW5lIEwxMDA4MS0xMDE1NSlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBMaXN0YSBjb21wbGV0YSBkZSBjb250YWN0YWRvcyAoY2xpZW50ZXMvcHJvc3BlY3RvcyBtYXJjYWRvcyBjb24gY2hlY2spXG5mdW5jdGlvbiBidWlsZENvbnRhY3RhZG9zUm93cygpIHtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICBjb250YWN0ZWQuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgY29uc3QgcGFydHMgPSBrZXkuc3BsaXQoJ3wnKTtcbiAgICBjb25zdCB0aXBvID0gcGFydHNbMF0sXG4gICAgICBwcm92aW5jZSA9IHBhcnRzWzFdLFxuICAgICAgbG9jTmFtZSA9IHBhcnRzWzJdLFxuICAgICAgY2xpZW50TmFtZSA9IHBhcnRzWzNdO1xuICAgIGNvbnN0IHB0ID0gUE9JTlRTLmZpbmQoKHApID0+IHAucHJvdmluY2UgPT09IHByb3ZpbmNlICYmIHAubmFtZSA9PT0gbG9jTmFtZSk7XG4gICAgY29uc3QgdmVuZG9yID0gcHQgPyBwdC52ZW5kb3IgOiAnJztcbiAgICBjb25zdCB2bSA9IHZlbmRvckxvb2t1cFt2ZW5kb3JdO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBUaXBvOiB0aXBvID09PSAnQycgPyAnQ2xpZW50ZSBhY3R1YWwnIDogJ1Byb3NwZWN0bycsXG4gICAgICBDbGllbnRlOiBjbGllbnROYW1lLFxuICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UocHJvdmluY2UpLFxuICAgICAgTG9jYWxpZGFkOiBsb2NOYW1lLFxuICAgICAgRGVwYXJ0YW1lbnRvOiBwdCA/IHB0LmRlcHQgfHwgJycgOiAnJyxcbiAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZG9yIHx8ICcnKSxcbiAgICAgIFpvbmE6IHZtID8gdm0uem9uZSA6ICcnLFxuICAgICAgQ29udGFjdGFkbzogJ1NpJyxcbiAgICB9KTtcbiAgfSk7XG4gIHJvd3Muc29ydChcbiAgICAoYSwgYikgPT5cbiAgICAgIGEuVmVuZGVkb3IubG9jYWxlQ29tcGFyZShiLlZlbmRlZG9yKSB8fFxuICAgICAgYS5Qcm92aW5jaWEubG9jYWxlQ29tcGFyZShiLlByb3ZpbmNpYSkgfHxcbiAgICAgIGEuQ2xpZW50ZS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSlcbiAgKTtcbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vIExvZyBkZSBvcGVyYWNpb25lcyAoY2FuY2VsYWNpb25lcywgZWxpbWluYWNpb25lcywgdnVlbHZlLWEtYm9ycmFkb3IsIGV0Yy4pXG5mdW5jdGlvbiBidWlsZE9wc0xvZ1Jvd3MoKSB7XG4gIHJldHVybiAob3BzTG9nQ2FjaGUgfHwgW10pLm1hcCgobykgPT4gKHtcbiAgICBGZWNoYTogby50aW1lc3RhbXBcbiAgICAgID8gby50aW1lc3RhbXAudG9EYXRlXG4gICAgICAgID8gby50aW1lc3RhbXAudG9EYXRlKCkudG9Mb2NhbGVTdHJpbmcoKVxuICAgICAgICA6IG5ldyBEYXRlKG8udGltZXN0YW1wKS50b0xvY2FsZVN0cmluZygpXG4gICAgICA6ICcnLFxuICAgIFVzdWFyaW86IG8udXNlckVtYWlsIHx8ICcnLFxuICAgIFJvbDogby51c2VyUm9sZSB8fCAnJyxcbiAgICBBY2Npb246IG8uYWN0aW9uIHx8ICcnLFxuICAgICdUaXBvIGVudGlkYWQnOiBvLmVudGl0eVR5cGUgfHwgJycsXG4gICAgRW50aWRhZDogby5lbnRpdHlOYW1lIHx8ICcnLFxuICAgIERldGFsbGVzOiB0eXBlb2Ygby5kZXRhaWxzID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KG8uZGV0YWlscykgOiBvLmRldGFpbHMgfHwgJycsXG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gYnVpbGRWaXNpdFJvd3MoKSB7XG4gIHJldHVybiB2aXNpdHNDYWNoZS5tYXAoKHYpID0+ICh7XG4gICAgRmVjaGE6IHYuZmVjaGEgfHwgJycsXG4gICAgTWVzOiB2Lm1lcyB8fCAnJyxcbiAgICBBbm86IHYuYW5pbyB8fCAnJyxcbiAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcbiAgICAnVGlwbyBjb250YWN0byc6IHYudGlwb0NvbnRhY3RvID09PSAndGVsZWZvbm8nID8gJ1RlbGVmb25vJyA6ICdQcmVzZW5jaWFsJyxcbiAgICBDb21lbnRhcmlvOiB2LmNvbWVudGFyaW8gfHwgJycsXG4gICAgUHJvdmluY2lhOiB0aXRsZUNhc2Uodi5wcm92aW5jaWEgfHwgJycpLFxuICAgIExvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXG4gICAgVGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcbiAgICAnVGlwbyB0aWVuZGEnOiB2LnRpcG8gfHwgJycsXG4gICAgTG9jYWw6IHYubG9jYWwgfHwgJycsXG4gICAgVGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcbiAgICBGaWRlbGlkYWQ6IHYuZmlkZWxpZGFkIHx8ICcnLFxuICAgICdSZWxldmFuY2lhICgxLTUpJzogdi5yZWxldmFuY2lhIHx8ICcnLFxuICAgIFBPUDogdi5wb3AgfHwgJycsXG4gICAgJ05lY2VzaWRhZCBwdW50dWFsJzogdi5uZWNlc2lkYWRQdW50dWFsID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2Lm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXG4gICAgJ1RpcG8gdmVudGEnOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXG4gICAgJyUgTW9zdHJhZG9yJzogdi5wb25kZXJhY2lvbk1vc3RyYWRvICE9IG51bGwgPyB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gOiAnJyxcbiAgICAnJSBFY29tbWVyY2UnOiB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXG4gICAgQ29tcGV0ZW5jaWE6IHYuY29tcGV0ZW5jaWEgfHwgJycsXG4gICAgJ0NhdGVnb3JpYSBjbGllbnRlJzogdi5jYXRlZ29yaWFDbGllbnRlIHx8ICcnLFxuICAgIE9wb3J0dW5pZGFkOiB2Lm9wb3J0dW5pZGFkIHx8ICcnLFxuICAgICdMbyBtYXMgdmVuZGlkbyBTaGltYW5vJzogdi5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICdMbyBxdWUgbWFzIHByZWd1bnRhbic6IHYubWFzUHJlZ3VudGFuIHx8ICcnLFxuICAgICdBeXVkYSBhIHRpZW5kYSc6IHYuYXl1ZGFUaWVuZGEgfHwgJycsXG4gICAgJ0ZvdG9zIGVzcGFjaW8gKGNhbnQpJzogKHYuZXNwYWNpbyB8fCBbXSkubGVuZ3RoLFxuICAgICdGb3RvIGZyZW50ZSc6IHYuZnJlbnRlTG9jYWwgPyAnU2knIDogJ05vJyxcbiAgICAnR1BTIGVzdGFkbyc6IHYuZ3BzU3RhdHVzIHx8ICcnLFxuICAgICdHUFMgZGlzdGFuY2lhIChtKSc6IHR5cGVvZiB2Lmdwc0Rpc3RhbmNlTSA9PT0gJ251bWJlcicgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxuICAgICdHUFMgbGF0Jzogdi5ncHNMYXQgIT0gbnVsbCA/IHYuZ3BzTGF0IDogJycsXG4gICAgJ0dQUyBsb24nOiB2Lmdwc0xvbiAhPSBudWxsID8gdi5ncHNMb24gOiAnJyxcbiAgICAnR1BTIHByZWNpc2lvbiAobSknOiB2Lmdwc0FjY3VyYWN5ICE9IG51bGwgPyB2Lmdwc0FjY3VyYWN5IDogJycsXG4gICAgJ0dQUyBjYXB0dXJhZG8nOiB2Lmdwc0NhcHR1cmVkQXQgfHwgJycsXG4gICAgRW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcbiAgfSkpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDQ0lcdTAwRDNOOiBleHBvcnRFeGVjdXRpdmUvVmlzaXRzL1Bvd2VyQkkvTUwgKGlubGluZSBMMTAxNTgtMTA0MjYpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxud2luZG93LmV4cG9ydEV4ZWN1dGl2ZSA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcbiAgY29uc3QgY29uZlJvd3MgPSByb3dzLmZpbHRlcigocikgPT4gci5lc3RhZG8gPT09ICdDb25maXJtYWRvJyk7XG5cbiAgLy8gQ29uc29saWRhZG86IHVuYSBmaWxhIHBvciB2ZW5kZWRvciBjb24gS1BJc1xuICBjb25zdCBwZXJWZW5kb3IgPSB7fTtcbiAgY29uZlJvd3MuZm9yRWFjaCgocikgPT4ge1xuICAgIGNvbnN0IGsgPSByLnZlbmRlZG9yIHx8ICdTaW4gYXNpZ25hcic7XG4gICAgaWYgKCFwZXJWZW5kb3Jba10pXG4gICAgICBwZXJWZW5kb3Jba10gPSB7XG4gICAgICAgIHpvbmE6IHIuem9uYSxcbiAgICAgICAgdW5pZDogMCxcbiAgICAgICAgYXJzOiAwLFxuICAgICAgICB1c2Q6IDAsXG4gICAgICAgIGNsaWVudGVzOiBuZXcgU2V0KCksXG4gICAgICAgIHByb2RzOiBuZXcgU2V0KCksXG4gICAgICAgIHByb3ZzOiBuZXcgU2V0KCksXG4gICAgICB9O1xuICAgIHBlclZlbmRvcltrXS51bmlkICs9IHIuY2FudGlkYWQ7XG4gICAgcGVyVmVuZG9yW2tdLmFycyArPSByLnN1YnRvdGFsX2FycztcbiAgICBwZXJWZW5kb3Jba10udXNkICs9IHIuc3VidG90YWxfdXNkO1xuICAgIHBlclZlbmRvcltrXS5jbGllbnRlcy5hZGQoci5jbGllbnRlKTtcbiAgICBwZXJWZW5kb3Jba10ucHJvZHMuYWRkKHIuY29kaWdvKTtcbiAgICBwZXJWZW5kb3Jba10ucHJvdnMuYWRkKHIucHJvdmluY2lhKTtcbiAgfSk7XG4gIGNvbnN0IGNvbnNvbCA9IFtdO1xuICBWRU5ET1JTLmZvckVhY2goKHYpID0+IHtcbiAgICBjb25zdCB0aXRsZVYgPSB0aXRsZUNhc2Uodi5rZXkpO1xuICAgIGNvbnN0IGQgPSBwZXJWZW5kb3JbdGl0bGVWXSB8fCB7XG4gICAgICB6b25hOiB2LnpvbmUsXG4gICAgICB1bmlkOiAwLFxuICAgICAgYXJzOiAwLFxuICAgICAgdXNkOiAwLFxuICAgICAgY2xpZW50ZXM6IG5ldyBTZXQoKSxcbiAgICAgIHByb2RzOiBuZXcgU2V0KCksXG4gICAgICBwcm92czogbmV3IFNldCgpLFxuICAgIH07XG4gICAgY29uc3QgdCA9IFRBUkdFVFNfQllfVkVORE9SW3Yua2V5XSB8fCB7IGp1bDIwMjZfdXNkOiAwLCBqdWxEaWMyMDI2X3VzZDogMCwgYW51YWwyMDI3X3VzZDogMCB9O1xuICAgIGNvbnNvbC5wdXNoKHtcbiAgICAgIFpvbmE6IHYuem9uZSxcbiAgICAgIFZlbmRlZG9yOiB0aXRsZVYsXG4gICAgICBQcm92aW5jaWFzOiBkLnByb3ZzLnNpemUsXG4gICAgICAnQ2xpZW50ZXMgYWN0aXZvcyc6IGQuY2xpZW50ZXMuc2l6ZSxcbiAgICAgICdQcm9kdWN0b3MgZGlzdGludG9zJzogZC5wcm9kcy5zaXplLFxuICAgICAgVW5pZGFkZXM6IGQudW5pZCxcbiAgICAgICdGYWN0dXJhZG8gQVJTJzogTWF0aC5yb3VuZChkLmFycyksXG4gICAgICAnRmFjdHVyYWRvIFVTRCc6IE1hdGgucm91bmQoZC51c2QpLFxuICAgICAgJ1RhcmdldCBKdWwgMjAyNiBVU0QnOiB0Lmp1bDIwMjZfdXNkLFxuICAgICAgJ1RhcmdldCBKdWwtRGljIDIwMjYgVVNEJzogdC5qdWxEaWMyMDI2X3VzZCxcbiAgICAgICdUYXJnZXQgMjAyNyBVU0QnOiB0LmFudWFsMjAyN191c2QsXG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCB3c0MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoY29uc29sKTtcbiAgd3NDWychY29scyddID0gW1xuICAgIHsgd2NoOiA2IH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gICAgeyB3Y2g6IDExIH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE2IH0sXG4gICAgeyB3Y2g6IDExIH0sXG4gICAgeyB3Y2g6IDE2IH0sXG4gICAgeyB3Y2g6IDE2IH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gIF07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzQywgJ0NvbnNvbGlkYWRvJyk7XG5cbiAgLy8gVW5hIGhvamEgcG9yIHZlbmRlZG9yIGNvbiBzdSBkZXRhbGxlIGRlIHBlZGlkb3MgY29uZmlybWFkb3NcbiAgVkVORE9SUy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgdGl0bGVWID0gdGl0bGVDYXNlKHYua2V5KTtcbiAgICBjb25zdCB2cm93cyA9IGNvbmZSb3dzXG4gICAgICAuZmlsdGVyKChyKSA9PiByLnZlbmRlZG9yID09PSB0aXRsZVYpXG4gICAgICAubWFwKChyKSA9PiAoe1xuICAgICAgICBGZWNoYTogci5mZWNoYSxcbiAgICAgICAgTWVzOiByLm1lc19wZWRpZG8sXG4gICAgICAgIFByb3ZpbmNpYTogci5wcm92aW5jaWEsXG4gICAgICAgIExvY2FsaWRhZDogci5sb2NhbGlkYWQsXG4gICAgICAgIENsaWVudGU6IHIuY2xpZW50ZSxcbiAgICAgICAgVGlwbzogci50aXBvX2NsaWVudGUsXG4gICAgICAgIENvZGlnbzogci5jb2RpZ28sXG4gICAgICAgIFByb2R1Y3RvOiByLnByb2R1Y3RvLFxuICAgICAgICBDYXRlZ29yaWE6IHIuY2F0ZWdvcmlhLFxuICAgICAgICBGYW1pbGlhOiByLmZhbWlsaWEsXG4gICAgICAgIFN1YmZhbWlsaWE6IHIuc3ViZmFtaWxpYSxcbiAgICAgICAgQ2FudGlkYWQ6IHIuY2FudGlkYWQsXG4gICAgICAgICdQcmVjaW8gQVJTJzogci5wcmVjaW9fdW5pdF9hcnMsXG4gICAgICAgICdTdWJ0b3RhbCBBUlMnOiByLnN1YnRvdGFsX2FycyxcbiAgICAgICAgJ1N1YnRvdGFsIFVTRCc6IHIuc3VidG90YWxfdXNkLFxuICAgICAgfSkpO1xuICAgIHZyb3dzLnNvcnQoXG4gICAgICAoYSwgYikgPT4gKGEuRmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5GZWNoYSB8fCAnJykgfHwgYS5DbGllbnRlLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlKVxuICAgICk7XG4gICAgaWYgKCF2cm93cy5sZW5ndGgpXG4gICAgICB2cm93cy5wdXNoKHtcbiAgICAgICAgRmVjaGE6ICcnLFxuICAgICAgICBNZXM6ICcnLFxuICAgICAgICBQcm92aW5jaWE6ICcnLFxuICAgICAgICBMb2NhbGlkYWQ6ICcnLFxuICAgICAgICBDbGllbnRlOiAnKHNpbiBwZWRpZG9zIGNvbmZpcm1hZG9zKScsXG4gICAgICAgIFRpcG86ICcnLFxuICAgICAgICBDb2RpZ286ICcnLFxuICAgICAgICBQcm9kdWN0bzogJycsXG4gICAgICAgIENhdGVnb3JpYTogJycsXG4gICAgICAgIEZhbWlsaWE6ICcnLFxuICAgICAgICBTdWJmYW1pbGlhOiAnJyxcbiAgICAgICAgQ2FudGlkYWQ6IDAsXG4gICAgICAgICdQcmVjaW8gQVJTJzogMCxcbiAgICAgICAgJ1N1YnRvdGFsIEFSUyc6IDAsXG4gICAgICAgICdTdWJ0b3RhbCBVU0QnOiAwLFxuICAgICAgfSk7XG4gICAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodnJvd3MpO1xuICAgIHdzWychY29scyddID0gW1xuICAgICAgeyB3Y2g6IDExIH0sXG4gICAgICB7IHdjaDogMTQgfSxcbiAgICAgIHsgd2NoOiAxOCB9LFxuICAgICAgeyB3Y2g6IDIyIH0sXG4gICAgICB7IHdjaDogMzAgfSxcbiAgICAgIHsgd2NoOiAxMSB9LFxuICAgICAgeyB3Y2g6IDE0IH0sXG4gICAgICB7IHdjaDogMzggfSxcbiAgICAgIHsgd2NoOiAxNCB9LFxuICAgICAgeyB3Y2g6IDE4IH0sXG4gICAgICB7IHdjaDogMTggfSxcbiAgICAgIHsgd2NoOiAxMCB9LFxuICAgICAgeyB3Y2g6IDEyIH0sXG4gICAgICB7IHdjaDogMTQgfSxcbiAgICAgIHsgd2NoOiAxNCB9LFxuICAgIF07XG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldChcbiAgICAgIHdiLFxuICAgICAgd3MsXG4gICAgICAodi56b25lICsgJyAnICsgdGl0bGVWKS5zdWJzdHJpbmcoMCwgMzEpLnJlcGxhY2UoL1tcXFxcLyo/W1xcXTpdL2csICcnKVxuICAgICk7XG4gIH0pO1xuXG4gIC8vIFZpc2l0YXNcbiAgY29uc3QgdmlzaXRSb3dzID0gYnVpbGRWaXNpdFJvd3MoKTtcbiAgaWYgKHZpc2l0Um93cy5sZW5ndGgpIHtcbiAgICBjb25zdCB3c1YgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodmlzaXRSb3dzKTtcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1YsICdWaXNpdGFzJyk7XG4gIH1cbiAgLy8gQ29udGFjdGFkb3MgKHRvZG9zIGxvcyBjbGllbnRlcy9wcm9zcGVjdG9zIG1hcmNhZG9zIGNvbiBjaGVjaylcbiAgY29uc3QgY29udGFjdFJvd3MgPSBidWlsZENvbnRhY3RhZG9zUm93cygpO1xuICBpZiAoY29udGFjdFJvd3MubGVuZ3RoKSB7XG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnRhY3RSb3dzKSwgJ0NvbnRhY3RhZG9zJyk7XG4gIH1cbiAgLy8gTG9nIGRlIG9wZXJhY2lvbmVzIChjYW5jZWxhY2lvbmVzLCBlbGltaW5hY2lvbmVzLCBldGMuKVxuICBjb25zdCBvcHNSb3dzID0gYnVpbGRPcHNMb2dSb3dzKCk7XG4gIGlmIChvcHNSb3dzLmxlbmd0aCkge1xuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChvcHNSb3dzKSwgJ0xvZyBPcGVyYWNpb25lcycpO1xuICB9XG5cbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX0VqZWN1dGl2b18nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xufTtcblxuLy8gLS0tLS0tLS0tLSBFeGNlbCBkZSBWaXNpdGFzIChmb3JtYXRvIHN0YW5kYWxvbmUpIC0tLS0tLS0tLS1cbndpbmRvdy5leHBvcnRWaXNpdHNFeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHZpc2l0Um93cyA9IGJ1aWxkVmlzaXRSb3dzKCk7XG4gIGlmICghdmlzaXRSb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzIHRvZGF2aWEuIEN1YW5kbyBzZSBjYXJndWUgYWwgbWVub3MgdW5hLCB2YXMgYSBwb2RlciBleHBvcnRhcmxhLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcblxuICAvLyBIb2phIHByaW5jaXBhbDogVmlzaXRhcyAodG9kYXMgbGFzIGZpbGFzKVxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3MpO1xuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMTIgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogOCB9LFxuICAgIHsgd2NoOiAyNCB9LFxuICAgIHsgd2NoOiAxOCB9LFxuICAgIHsgd2NoOiAyMiB9LFxuICAgIHsgd2NoOiAzMCB9LFxuICAgIHsgd2NoOiAxOCB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAxNiB9LFxuICAgIHsgd2NoOiA4IH0sXG4gICAgeyB3Y2g6IDIyIH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDMyIH0sXG4gICAgeyB3Y2g6IDMyIH0sXG4gICAgeyB3Y2g6IDMyIH0sXG4gICAgeyB3Y2g6IDMyIH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gIF07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnVmlzaXRhcycpO1xuXG4gIC8vIEhvamEgcmVzdW1lbiBwb3IgdmVuZGVkb3I6IGNhbnRpZGFkIGRlIHZpc2l0YXMgeSB0aWVuZGFzIHVuaWNhc1xuICBjb25zdCBwZXJWZW5kb3IgPSB7fTtcbiAgdmlzaXRzQ2FjaGUuZm9yRWFjaCgodikgPT4ge1xuICAgIGNvbnN0IGsgPSB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJ1NpbiBhc2lnbmFyJyk7XG4gICAgaWYgKCFwZXJWZW5kb3Jba10pXG4gICAgICBwZXJWZW5kb3Jba10gPSB7XG4gICAgICAgIHZpc2l0YXM6IDAsXG4gICAgICAgIHRpZW5kYXM6IG5ldyBTZXQoKSxcbiAgICAgICAgbG9jYWxpZGFkZXM6IG5ldyBTZXQoKSxcbiAgICAgICAgcHJvdmluY2lhczogbmV3IFNldCgpLFxuICAgICAgfTtcbiAgICBwZXJWZW5kb3Jba10udmlzaXRhcysrO1xuICAgIGlmICh2LnRpZW5kYSkgcGVyVmVuZG9yW2tdLnRpZW5kYXMuYWRkKHYudGllbmRhKTtcbiAgICBpZiAodi5sb2NhbGlkYWQpIHBlclZlbmRvcltrXS5sb2NhbGlkYWRlcy5hZGQodi5sb2NhbGlkYWQpO1xuICAgIGlmICh2LnByb3ZpbmNpYSkgcGVyVmVuZG9yW2tdLnByb3ZpbmNpYXMuYWRkKHYucHJvdmluY2lhKTtcbiAgfSk7XG4gIGNvbnN0IHJlc3VtZW4gPSBPYmplY3QuZW50cmllcyhwZXJWZW5kb3IpXG4gICAgLm1hcCgoW3ZlbmRlZG9yLCBkXSkgPT4gKHtcbiAgICAgIFZlbmRlZG9yOiB2ZW5kZWRvcixcbiAgICAgICdWaXNpdGFzIHRvdGFsZXMnOiBkLnZpc2l0YXMsXG4gICAgICAnVGllbmRhcyBkaXN0aW50YXMnOiBkLnRpZW5kYXMuc2l6ZSxcbiAgICAgICdMb2NhbGlkYWRlcyBkaXN0aW50YXMnOiBkLmxvY2FsaWRhZGVzLnNpemUsXG4gICAgICAnUHJvdmluY2lhcyBkaXN0aW50YXMnOiBkLnByb3ZpbmNpYXMuc2l6ZSxcbiAgICB9KSlcbiAgICAuc29ydCgoYSwgYikgPT4gYlsnVmlzaXRhcyB0b3RhbGVzJ10gLSBhWydWaXNpdGFzIHRvdGFsZXMnXSk7XG4gIGlmIChyZXN1bWVuLmxlbmd0aCkge1xuICAgIGNvbnN0IHdzUiA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyZXN1bWVuKTtcbiAgICB3c1JbJyFjb2xzJ10gPSBbeyB3Y2g6IDI0IH0sIHsgd2NoOiAxNiB9LCB7IHdjaDogMTggfSwgeyB3Y2g6IDIyIH0sIHsgd2NoOiAyMiB9XTtcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1IsICdSZXN1bWVuIHBvciB2ZW5kZWRvcicpO1xuICB9XG5cbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX1Zpc2l0YXNfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnKTtcbn07XG5cbi8vIC0tLS0tLS0tLS0gT1BDSU9OIEI6IFBvd2VyIEJJIChGYWN0ICsgRGltKSAtLS0tLS0tLS0tXG53aW5kb3cuZXhwb3J0UG93ZXJCSSA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcblxuICAvLyBGYWN0X1BlZGlkb3NcbiAgY29uc3QgZmFjdFJvd3MgPSByb3dzLmZpbHRlcigocikgPT4gci5lc3RhZG8gIT09ICdCb3JyYWRvcicpO1xuICBjb25zdCB3c0YgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoXG4gICAgZmFjdFJvd3MubWFwKChyKSA9PiAoe1xuICAgICAgbGluZV9pZDogci5saW5lX2lkLFxuICAgICAgZmVjaGE6IHIuZmVjaGEsXG4gICAgICBlc3RhZG86IHIuZXN0YWRvLFxuICAgICAgdmVuZGVkb3Jfa2V5OiByLnZlbmRlZG9yX2tleSxcbiAgICAgIHpvbmE6IHIuem9uYSxcbiAgICAgIHByb3ZpbmNpYTogci5wcm92aW5jaWEsXG4gICAgICBsb2NhbGlkYWQ6IHIubG9jYWxpZGFkLFxuICAgICAgY2xpZW50ZTogci5jbGllbnRlLFxuICAgICAgdGlwb19jbGllbnRlOiByLnRpcG9fY2xpZW50ZSxcbiAgICAgIHNrdTogci5jb2RpZ28sXG4gICAgICBjYW50aWRhZDogci5jYW50aWRhZCxcbiAgICAgIHByZWNpb191bml0X2Fyczogci5wcmVjaW9fdW5pdF9hcnMsXG4gICAgICBzdWJ0b3RhbF9hcnM6IHIuc3VidG90YWxfYXJzLFxuICAgICAgc3VidG90YWxfdXNkOiByLnN1YnRvdGFsX3VzZCxcbiAgICB9KSlcbiAgKTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NGLCAnRmFjdF9QZWRpZG9zJyk7XG5cbiAgLy8gRGltX1ZlbmRlZG9yXG4gIGNvbnN0IGRpbVYgPSBWRU5ET1JTLm1hcCgodikgPT4ge1xuICAgIGNvbnN0IHQgPSBUQVJHRVRTX0JZX1ZFTkRPUlt2LmtleV0gfHwge307XG4gICAgcmV0dXJuIHtcbiAgICAgIHZlbmRlZG9yX2tleTogdi5rZXksXG4gICAgICB2ZW5kZWRvcl9ub21icmU6IHRpdGxlQ2FzZSh2LmtleSksXG4gICAgICB6b25hOiB2LnpvbmUsXG4gICAgICB6b25hX2Rlc2NyaXBjaW9uOiB2LmxhYmVsLFxuICAgICAgY29sb3I6IHYuY29sb3IsXG4gICAgICB0YXJnZXRfanVsMjAyNl91c2Q6IHQuanVsMjAyNl91c2QgfHwgMCxcbiAgICAgIHRhcmdldF9qdWxEaWMyMDI2X3VzZDogdC5qdWxEaWMyMDI2X3VzZCB8fCAwLFxuICAgICAgdGFyZ2V0XzIwMjdfdXNkOiB0LmFudWFsMjAyN191c2QgfHwgMCxcbiAgICB9O1xuICB9KTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbVYpLCAnRGltX1ZlbmRlZG9yJyk7XG5cbiAgLy8gRGltX1Byb2R1Y3RvXG4gIGNvbnN0IGRpbVAgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XG4gICAgc2t1OiBwLmNvZGUsXG4gICAgZGVzY3JpcGNpb246IHAuZGVzYyxcbiAgICBjYXRlZ29yaWE6IHAuY2F0LFxuICAgIGZhbWlsaWE6IHAuZmFtLFxuICAgIHN1YmZhbWlsaWE6IHAuc3ViLFxuICB9KSk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1QKSwgJ0RpbV9Qcm9kdWN0bycpO1xuXG4gIC8vIERpbV9DbGllbnRlICh1bml2ZXJzbylcbiAgY29uc3QgZGltQyA9IFtdO1xuICBQT0lOVFMuZm9yRWFjaCgocCkgPT4ge1xuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3AudmVuZG9yXTtcbiAgICBwLmNsaWVudHMuZm9yRWFjaCgobikgPT4ge1xuICAgICAgZGltQy5wdXNoKHtcbiAgICAgICAgY2xpZW50ZTogbixcbiAgICAgICAgdGlwbzogJ0NsaWVudGUgYWN0dWFsJyxcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXG4gICAgICAgIGxvY2FsaWRhZDogcC5uYW1lLFxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3Jfa2V5OiBwLnZlbmRvciB8fCAnJyxcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBwLnByb3NwZWN0cy5mb3JFYWNoKChuKSA9PiB7XG4gICAgICBkaW1DLnB1c2goe1xuICAgICAgICBjbGllbnRlOiBuLFxuICAgICAgICB0aXBvOiAnUHJvc3BlY3RvJyxcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXG4gICAgICAgIGxvY2FsaWRhZDogcC5uYW1lLFxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3Jfa2V5OiBwLnZlbmRvciB8fCAnJyxcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1DKSwgJ0RpbV9DbGllbnRlJyk7XG5cbiAgLy8gRGltX0NhbGVuZGFyaW8gKGZlY2hhcyBkaXN0aW50YXMgZW4gbG9zIHBlZGlkb3MgKyBzZXJpZSBjb250aW51YSBkZWwgYVx1MDBGMW8gYWN0dWFsKVxuICBjb25zdCBjYWxTZXQgPSBuZXcgU2V0KCk7XG4gIGZhY3RSb3dzLmZvckVhY2goKHIpID0+IHtcbiAgICBpZiAoci5mZWNoYSkgY2FsU2V0LmFkZChyLmZlY2hhKTtcbiAgfSk7XG4gIC8vIENvbXBsZXRhciBkZXNkZSAyMDI2LTAxLTAxIGhhc3RhIGhveSArIDM2NVxuICBjb25zdCBzdGFydCA9IG5ldyBEYXRlKCcyMDI2LTAxLTAxJyk7XG4gIGNvbnN0IGVuZCA9IG5ldyBEYXRlKCk7XG4gIGVuZC5zZXREYXRlKGVuZC5nZXREYXRlKCkgKyAzNjUpO1xuICBmb3IgKGxldCBkID0gbmV3IERhdGUoc3RhcnQpOyBkIDw9IGVuZDsgZC5zZXREYXRlKGQuZ2V0RGF0ZSgpICsgMSkpXG4gICAgY2FsU2V0LmFkZChkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApKTtcbiAgY29uc3QgZGltQ2FsID0gWy4uLmNhbFNldF0uc29ydCgpLm1hcCgoZHQpID0+IHtcbiAgICBjb25zdCBbeSwgbSwgZGFdID0gZHQuc3BsaXQoJy0nKS5tYXAoKHgpID0+IHBhcnNlSW50KHgsIDEwKSk7XG4gICAgY29uc3QgZGF0ZU9iaiA9IG5ldyBEYXRlKHksIG0gLSAxLCBkYSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGZlY2hhOiBkdCxcbiAgICAgIHllYXI6IHksXG4gICAgICBtb250aDogbSxcbiAgICAgIGRheTogZGEsXG4gICAgICBxdWFydGVyOiAnUScgKyAoTWF0aC5mbG9vcigobSAtIDEpIC8gMykgKyAxKSxcbiAgICAgIG1vbnRoX25hbWU6IE1FU0VTW20gLSAxXSxcbiAgICAgIHllYXJfbW9udGg6IHkgKyAnLScgKyBTdHJpbmcobSkucGFkU3RhcnQoMiwgJzAnKSxcbiAgICAgIGRheV9vZl93ZWVrOiBbJ0RvbScsICdMdW4nLCAnTWFyJywgJ01pZScsICdKdWUnLCAnVmllJywgJ1NhYiddW2RhdGVPYmouZ2V0RGF5KCldLFxuICAgIH07XG4gIH0pO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltQ2FsKSwgJ0RpbV9DYWxlbmRhcmlvJyk7XG5cbiAgLy8gRGltX0NhbXBhbmlhXG4gIGNvbnN0IGRpbUNtcCA9IGNhbXBhaWduc0NhY2hlLm1hcCgoYykgPT4gKHtcbiAgICBjYW1wYW5pYV9pZDogYy5pZCxcbiAgICBub21icmU6IGMubmFtZSxcbiAgICBmaWx0ZXJfdHlwZTogYy5maWx0ZXJUeXBlLFxuICAgIGZpbHRlcl92YWx1ZXM6IChjLmZpbHRlclZhbHVlcyB8fCBbXSkuam9pbignLCAnKSxcbiAgICB0YXJnZXRfdHlwZTogYy50YXJnZXRUeXBlLFxuICAgIHRhcmdldF9hbW91bnQ6IGMudGFyZ2V0QW1vdW50LFxuICAgIGRlc2RlOiBjLnN0YXJ0RGF0ZSxcbiAgICBoYXN0YTogYy5lbmREYXRlLFxuICB9KSk7XG4gIGlmIChkaW1DbXAubGVuZ3RoKVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1DbXApLCAnRGltX0NhbXBhbmlhJyk7XG5cbiAgLy8gUGFyYW1zICh0aXBvIGRlIGNhbWJpbywgZmVjaGEgZXhwb3J0LCB2ZXJzaW9uKVxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxuICAgIHdiLFxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChbXG4gICAgICB7IHBhcmFtZXRybzogJ2V4Y2hhbmdlX3JhdGVfYXJzX3VzZCcsIHZhbG9yOiBFWENIQU5HRV9SQVRFIH0sXG4gICAgICB7IHBhcmFtZXRybzogJ2ZlY2hhX2V4cG9ydCcsIHZhbG9yOiB0b2RheVN0cigpIH0sXG4gICAgICB7IHBhcmFtZXRybzogJ3RvdGFsX2ZpbGFzX2ZhY3QnLCB2YWxvcjogZmFjdFJvd3MubGVuZ3RoIH0sXG4gICAgXSksXG4gICAgJ1BhcmFtZXRyb3MnXG4gICk7XG5cbiAgLy8gRmFjdF9WaXNpdGFzXG4gIGNvbnN0IHZpc2l0Um93c0IgPSBidWlsZFZpc2l0Um93cygpO1xuICBpZiAodmlzaXRSb3dzQi5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93c0IpLCAnRmFjdF9WaXNpdGFzJyk7XG4gIC8vIENvbnRhY3RhZG9zXG4gIGNvbnN0IGNvbnRhY3RSb3dzQiA9IGJ1aWxkQ29udGFjdGFkb3NSb3dzKCk7XG4gIGlmIChjb250YWN0Um93c0IubGVuZ3RoKVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb250YWN0Um93c0IpLCAnQ29udGFjdGFkb3MnKTtcbiAgLy8gTG9nIGRlIG9wZXJhY2lvbmVzXG4gIGNvbnN0IG9wc1Jvd3NCID0gYnVpbGRPcHNMb2dSb3dzKCk7XG4gIGlmIChvcHNSb3dzQi5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KG9wc1Jvd3NCKSwgJ0xvZ19PcGVyYWNpb25lcycpO1xuXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19Qb3dlckJJXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XG59O1xuXG4vLyAtLS0tLS0tLS0tIE9QQ0lPTiBDOiBQeXRob24gLyBJQSAvIE1MIChzaW5nbGUgbG9uZy1mb3JtYXQgdGFibGUpIC0tLS0tLS0tLS1cbndpbmRvdy5leHBvcnRNTCA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcbiAgLy8gbWFzdGVyX21sOiB1bmEgZmlsYSBwb3IgbGluZWEgY29uIFRPREFTIGxhcyBmZWF0dXJlc1xuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcbiAgd3NbJyFjb2xzJ10gPSBPYmplY3Qua2V5cyhyb3dzWzBdIHx8IHsgZmVjaGE6ICcnIH0pLm1hcCgoKSA9PiAoeyB3Y2g6IDE0IH0pKTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdtYXN0ZXJfbWwnKTtcblxuICAvLyBjYXRhbG9nbyB5IHVuaXZlcnNvIGRlIGNsaWVudGVzIGNvbW8gcmVmZXJlbmNpYXMgcGFyYSBlbnJpcXVlY2VyIGVuIHBhbmRhc1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxuICAgIHdiLFxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChcbiAgICAgIFBST0RVQ1RTLm1hcCgocCkgPT4gKHsgY29kZTogcC5jb2RlLCBkZXNjOiBwLmRlc2MsIGNhdDogcC5jYXQsIGZhbTogcC5mYW0sIHN1YjogcC5zdWIgfSkpXG4gICAgKSxcbiAgICAncHJvZHVjdG9zX2NhdGFsb2dvJ1xuICApO1xuXG4gIGNvbnN0IHVuaXZlcnNlID0gW107XG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3Qgdm0gPSB2ZW5kb3JMb29rdXBbcC52ZW5kb3JdO1xuICAgIHAuY2xpZW50cy5mb3JFYWNoKChuKSA9PiB7XG4gICAgICB1bml2ZXJzZS5wdXNoKHtcbiAgICAgICAgY2xpZW50ZTogbixcbiAgICAgICAgdGlwbzogJ2NsaWVudGVfYWN0dWFsJyxcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXG4gICAgICAgIGxvY2FsaWRhZDogcC5uYW1lLFxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3I6IHRpdGxlQ2FzZShwLnZlbmRvciB8fCAnJyksXG4gICAgICAgIHpvbmE6IHZtID8gdm0uem9uZSA6ICcnLFxuICAgICAgICBsYXQ6IHAubGF0LFxuICAgICAgICBsb246IHAubG9uLFxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgcC5wcm9zcGVjdHMuZm9yRWFjaCgobikgPT4ge1xuICAgICAgdW5pdmVyc2UucHVzaCh7XG4gICAgICAgIGNsaWVudGU6IG4sXG4gICAgICAgIHRpcG86ICdwcm9zcGVjdG8nLFxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXG4gICAgICAgIGRlcGFydGFtZW50bzogcC5kZXB0IHx8ICcnLFxuICAgICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHAudmVuZG9yIHx8ICcnKSxcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICAgIGxhdDogcC5sYXQsXG4gICAgICAgIGxvbjogcC5sb24sXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh1bml2ZXJzZSksICd1bml2ZXJzb19jbGllbnRlcycpO1xuXG4gIC8vIHRhcmdldHMgY29tbyB0YWJsYSBsb25nXG4gIGNvbnN0IHRhcmdldHNMb25nID0gW107XG4gIE9iamVjdC5lbnRyaWVzKFRBUkdFVFNfQllfVkVORE9SKS5mb3JFYWNoKChbdmVuZG9yLCB0XSkgPT4ge1xuICAgIHRhcmdldHNMb25nLnB1c2goe1xuICAgICAgdmVuZGVkb3I6IGRpc3BsYXlWZW5kb3JOYW1lKHZlbmRvciksXG4gICAgICBwZXJpb2RvOiAnSnVsIDIwMjYnLFxuICAgICAgc3RhcnRfZGF0ZTogJzIwMjYtMDctMDEnLFxuICAgICAgZW5kX2RhdGU6ICcyMDI2LTA3LTMxJyxcbiAgICAgIHRhcmdldF91c2Q6IHQuanVsMjAyNl91c2QgfHwgMCxcbiAgICB9KTtcbiAgICB0YXJnZXRzTG9uZy5wdXNoKHtcbiAgICAgIHZlbmRlZG9yOiBkaXNwbGF5VmVuZG9yTmFtZSh2ZW5kb3IpLFxuICAgICAgcGVyaW9kbzogJ0p1bC1EaWMgMjAyNicsXG4gICAgICBzdGFydF9kYXRlOiAnMjAyNi0wNy0wMScsXG4gICAgICBlbmRfZGF0ZTogJzIwMjYtMTItMzEnLFxuICAgICAgdGFyZ2V0X3VzZDogdC5qdWxEaWMyMDI2X3VzZCB8fCAwLFxuICAgIH0pO1xuICAgIHRhcmdldHNMb25nLnB1c2goe1xuICAgICAgdmVuZGVkb3I6IGRpc3BsYXlWZW5kb3JOYW1lKHZlbmRvciksXG4gICAgICBwZXJpb2RvOiAnMjAyNycsXG4gICAgICBzdGFydF9kYXRlOiAnMjAyNy0wMS0wMScsXG4gICAgICBlbmRfZGF0ZTogJzIwMjctMTItMzEnLFxuICAgICAgdGFyZ2V0X3VzZDogdC5hbnVhbDIwMjdfdXNkIHx8IDAsXG4gICAgfSk7XG4gIH0pO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodGFyZ2V0c0xvbmcpLCAndGFyZ2V0c19sb25nJyk7XG5cbiAgLy8gY2FtcGFcdTAwRjFhc1xuICBpZiAoY2FtcGFpZ25zQ2FjaGUubGVuZ3RoKSB7XG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldChcbiAgICAgIHdiLFxuICAgICAgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFxuICAgICAgICBjYW1wYWlnbnNDYWNoZS5tYXAoKGMpID0+ICh7XG4gICAgICAgICAgaWQ6IGMuaWQsXG4gICAgICAgICAgbm9tYnJlOiBjLm5hbWUsXG4gICAgICAgICAgZmlsdGVyX3R5cGU6IGMuZmlsdGVyVHlwZSxcbiAgICAgICAgICBmaWx0ZXJfdmFsdWVzOiAoYy5maWx0ZXJWYWx1ZXMgfHwgW10pLmpvaW4oJywnKSxcbiAgICAgICAgICB0YXJnZXRfdHlwZTogYy50YXJnZXRUeXBlLFxuICAgICAgICAgIHRhcmdldF9hbW91bnQ6IGMudGFyZ2V0QW1vdW50LFxuICAgICAgICAgIHN0YXJ0X2RhdGU6IGMuc3RhcnREYXRlLFxuICAgICAgICAgIGVuZF9kYXRlOiBjLmVuZERhdGUsXG4gICAgICAgIH0pKVxuICAgICAgKSxcbiAgICAgICdjYW1wYW5pYXMnXG4gICAgKTtcbiAgfVxuXG4gIC8vIHBhcmFtZXRyb3NcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldChcbiAgICB3YixcbiAgICBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoW1xuICAgICAgeyBwYXJhbWV0cm86ICdleGNoYW5nZV9yYXRlX2Fyc191c2QnLCB2YWxvcjogRVhDSEFOR0VfUkFURSB9LFxuICAgICAgeyBwYXJhbWV0cm86ICdmZWNoYV9leHBvcnQnLCB2YWxvcjogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXG4gICAgXSksXG4gICAgJ3BhcmFtZXRyb3MnXG4gICk7XG5cbiAgLy8gdmlzaXRhc1xuICBjb25zdCB2aXNpdFJvd3NDID0gYnVpbGRWaXNpdFJvd3MoKTtcbiAgaWYgKHZpc2l0Um93c0MubGVuZ3RoKVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3NDKSwgJ3Zpc2l0YXMnKTtcbiAgLy8gY29udGFjdGFkb3NcbiAgY29uc3QgY29udGFjdFJvd3NDID0gYnVpbGRDb250YWN0YWRvc1Jvd3MoKTtcbiAgaWYgKGNvbnRhY3RSb3dzQy5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnRhY3RSb3dzQyksICdjb250YWN0YWRvcycpO1xuICAvLyBsb2cgZGUgb3BlcmFjaW9uZXNcbiAgY29uc3Qgb3BzUm93c0MgPSBidWlsZE9wc0xvZ1Jvd3MoKTtcbiAgaWYgKG9wc1Jvd3NDLmxlbmd0aClcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQob3BzUm93c0MpLCAnbG9nX29wZXJhY2lvbmVzJyk7XG5cbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX01MXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIHYzNzErOiBFeHBvcnQgZGF0YXNldCBwYXJhIGFuXHUwMEUxbGlzaXMgKFpJUCBkZSBDU1ZzIHBhcmEgTUwgcGlwZWxpbmVzKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQWJyZSBlbCBtb2RhbCBjaGljbyBkaXNwYXRjaGVyIGRlbCBib3RvbiBcIkV4cG9ydGFyIGEgRXhjZWxcIi4gTXVlc3RyYVxuICogMiB0YXJqZXRhczogUmVwb3J0ZXMgRXhjZWwgKHRvZG9zKSB2cyBEYXRhc2V0IFpJUCAoc29sbyBhZG1pbi9nZXJlbnRlKS5cbiAqL1xud2luZG93Lm9wZW5FeHBvcnRGb3JtYXRNb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgLy8gT2N1bHRhci9tb3N0cmFyIHRhcmpldGEgRGF0YXNldCBzZWd1biByb2wuXG4gIGNvbnN0IGRzT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtZGF0YXNldC16aXAnKTtcbiAgaWYgKGRzT3B0KSB7XG4gICAgY29uc3QgaXNBZG1pbk9yR2VyZW50ZSA9IHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAnZ2VyZW50ZSc7XG4gICAgZHNPcHQuc3R5bGUuZGlzcGxheSA9IGlzQWRtaW5PckdlcmVudGUgPyAnJyA6ICdub25lJztcbiAgfVxuICAvLyBPY3VsdGFyIHByb2dyZXNzIGJhciAocG9yIHNpIHF1ZWRvIGFiaWVydG8gZGUgdW5hIGVqZWN1Y2lvbiBhbnRlcmlvcilcbiAgY29uc3QgcHJvZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZGF0YXNldC1wcm9ncmVzcycpO1xuICBpZiAocHJvZykgcHJvZy5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG5cbndpbmRvdy5jbG9zZUV4cG9ydEZvcm1hdE1vZGFsID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8qKlxuICogQWN0dWFsaXphIGVsIHN0YXR1cyArIGJhcnJhIGRlbCBtb2RhbC4gc3RhdHVzIGVzIHRleHRvIGxpYnJlOyBwZXJjZW50IDAuLjEwMC5cbiAqL1xuZnVuY3Rpb24gX3VwZGF0ZUV4cG9ydFByb2dyZXNzKHN0YXR1cywgcGVyY2VudCkge1xuICBjb25zdCBzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LXN0YXR1cycpO1xuICBjb25zdCBiID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LWJhcicpO1xuICBjb25zdCB3cmFwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LXByb2dyZXNzJyk7XG4gIGlmICh3cmFwKSB3cmFwLnN0eWxlLmRpc3BsYXkgPSAnJztcbiAgaWYgKHMpIHMudGV4dENvbnRlbnQgPSBzdGF0dXM7XG4gIGlmIChiKSBiLnN0eWxlLndpZHRoID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBwZXJjZW50KSkgKyAnJSc7XG59XG5cbi8qKlxuICogRmV0Y2ggc3RvY2suanNvbiBkZWwgcm9vdCBkZWwgc2l0aW8gKHYzNjkrIHRpZW5lIHdhcmVob3VzZUJyZWFrZG93bikuXG4gKiBDYWNoZS1idXN0aW5nIGNvbiA/dD0gcGFyYSBldml0YXIgU1cuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIF9mZXRjaFN0b2NrSnNvbigpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCByID0gYXdhaXQgZmV0Y2goJy4vc3RvY2suanNvbj90PScgKyBEYXRlLm5vdygpLCB7IGNhY2hlOiAnbm8tc3RvcmUnIH0pO1xuICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByLnN0YXR1cyk7XG4gICAgcmV0dXJuIGF3YWl0IHIuanNvbigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdbZXhwb3J0RGF0YXNldFppcF0gc3RvY2suanNvbiBmYWxsbzonLCBlICYmIGUubWVzc2FnZSk7XG4gICAgcmV0dXJuIG51bGw7IC8vIG5vIGJsb3F1ZWFudGUgXHUyMDE0IHByb2R1Y3Rvcy5jc3YgcXVlZGEgdmFjaW9cbiAgfVxufVxuXG4vKipcbiAqIExhenkgbG9hZCBKU1ppcCAocGF0cm9uIHlhIHVzYWRvIGVuIGV4cG9ydFBob3Rvc1ppcCBsaW5lYSB+NDcpLlxuICovXG5hc3luYyBmdW5jdGlvbiBfZW5zdXJlSlNaaXBMb2FkZWQoKSB7XG4gIGlmICh0eXBlb2YgSlNaaXAgIT09ICd1bmRlZmluZWQnKSByZXR1cm47XG4gIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XG4gICAgcy5zcmMgPSAnaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4L2xpYnMvanN6aXAvMy4xMC4xL2pzemlwLm1pbi5qcyc7XG4gICAgcy5vbmxvYWQgPSByZXNvbHZlO1xuICAgIHMub25lcnJvciA9ICgpID0+IHJlamVjdChuZXcgRXJyb3IoJ05vIHNlIHB1ZG8gY2FyZ2FyIEpTWmlwJykpO1xuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQocyk7XG4gIH0pO1xufVxuXG4vKipcbiAqIERlc2NhcmdhIHVuIEJsb2IgY29tbyBhcmNoaXZvLiBSZXVzYSBlbCBwYXRyb24gZGUgZXhwb3J0UGhvdG9zWmlwLlxuICovXG5mdW5jdGlvbiBfZG93bmxvYWRCbG9iKGJsb2IsIGZpbGVuYW1lKSB7XG4gIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gIGEuaHJlZiA9IHVybDtcbiAgYS5kb3dubG9hZCA9IGZpbGVuYW1lO1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICBhLmNsaWNrKCk7XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG4gICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xuICB9LCAxMDApO1xufVxuXG4vKipcbiAqIEVYUE9SVCBQUklOQ0lQQUwuIFNvbG8gYWRtaW4vZ2VyZW50ZS4gR2VuZXJhIFpJUCBjb246XG4gKiAgLSBwZWRpZG9zLmNzdiwgdmlzaXRhcy5jc3YsIGNsaWVudGVzLmNzdiwgY2xpZW50X21hc3Rlci5jc3YsIHJlbmRpY2lvbmVzLmNzdixcbiAqICAgIGNhbXBhbmlhcy5jc3YsIHRhcmdldHMuY3N2LCBwcm9kdWN0b3MuY3N2LCB2ZW5kb3Jfb3ZlcnJpZGVzLmNzdixcbiAqICAgIGN1c3RvbV9yb3V0ZXMuY3N2LCBzZWd1aW1pZW50b19ub3Rlcy5jc3ZcbiAqICAtIG1hbmlmZXN0Lmpzb24gKHNjaGVtYSArIHVzZUNhc2VNYXRyaXggKyByb3dDb3VudHMgKyBudWxsUmF0ZUJ5RmllbGQgKyBsaW1pdGF0aW9ucylcbiAqXG4gKiBDYXNvcyBib3JkZSBtYW5lamFkb3M6XG4gKiAgLSBTaSBhbGd1bmEgLmdldCgpIGZhbGxhIC0+IGFsZXJ0ICsgbm8gZGVzY2FyZ2FyIChubyBnZW5lcmEgWklQIHBhcmNpYWwgc2lsZW5jaW9zbykuXG4gKiAgLSBTaSBzdG9jay5qc29uIG5vIHJlc3BvbmRlIC0+IHByb2R1Y3Rvcy5jc3YgcXVlZGEgdmFjaW8gY29uIHdhcm5pbmcgZW4gbWFuaWZlc3QuXG4gKiAgLSBQcm9ncmVzcyBiYXIgZW4gZWwgbW9kYWwgcGFyYSBmZWVkYmFjayAofjEwLTMwIHNlZykuXG4gKi9cbndpbmRvdy5leHBvcnREYXRhc2V0WmlwID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicgJiYgdXNlclJvbGUgIT09ICdnZXJlbnRlJykge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZW4gZXhwb3J0YXIgZWwgZGF0YXNldC4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFmYkRiKSB7XG4gICAgYWxlcnQoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8uIFJlY2FyZ2EgbGEgYXBwLicpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFJlLWFicmlyIG1vZGFsIHNpIGVsIHVzdWFyaW8gY2Vycm8geSBuYXZlZ2Ftb3MgcG9yIG90cm8gZmx1am8uXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZm9ybWF0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ1ByZXBhcmFuZG8uLi4nLCA1KTtcblxuICB0cnkge1xuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnQ2FyZ2FuZG8gSlNaaXAuLi4nLCAxMCk7XG4gICAgYXdhaXQgX2Vuc3VyZUpTWmlwTG9hZGVkKCk7XG5cbiAgICAvLyAxKSBGZXRjaCAxMyBjb2xlY2Npb25lcyBGaXJlc3RvcmUgZW4gcGFyYWxlbG8gKyBzdG9jay5qc29uLlxuICAgIC8vIHY3MzIgKDIwMjYtMDgtMjkpOiArIHNhcF9zbmFwc2hvdCwgZmFjdHVyYWNpb25fc25hcHNob3QsIGJhY2tvcmRlcl9zbmFwc2hvdFxuICAgIC8vIChhbnRlcyBleGNsdWlkb3M7IGFob3JhIGZ1ZW50ZSBkZSB2ZXJkYWQgZGUgZmFjdHVyYWNpb24gcmVhbCBTQVAgKyBkZW1hbmRcbiAgICAvLyBzdXByZXNzaW9uICsgYWdyZWdhZG9zIGRpYXJpb3MgbGlzdG9zLXBhcmEtYmVuY2htYXJrKS5cbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0xleWVuZG8gRmlyZXN0b3JlICgxMyBjb2xlY2Npb25lcykuLi4nLCAyMCk7XG4gICAgY29uc3QgZmlyZXN0b3JlRW50cmllcyA9IFtcbiAgICAgIFsncGVkaWRvcycsIGZiRGIuY29sbGVjdGlvbigncGVkaWRvcycpLmdldCgpXSxcbiAgICAgIFsndmlzaXRhcycsIGZiRGIuY29sbGVjdGlvbigndmlzaXRzJykuZ2V0KCldLFxuICAgICAgWydjbGllbnRlcycsIGZiRGIuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpLmdldCgpXSxcbiAgICAgIFsnY2xpZW50X21hc3RlcicsIGZiRGIuY29sbGVjdGlvbignY2xpZW50X21hc3RlcicpLmdldCgpXSxcbiAgICAgIFsncmVuZGljaW9uZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ3JlbmRpY2lvbmVzJykuZ2V0KCldLFxuICAgICAgWydjYW1wYW5pYXMnLCBmYkRiLmNvbGxlY3Rpb24oJ2NhbXBhaWducycpLmdldCgpXSxcbiAgICAgIFsndGFyZ2V0cycsIGZiRGIuY29sbGVjdGlvbigndGFyZ2V0cycpLmdldCgpXSxcbiAgICAgIFsndmVuZG9yX292ZXJyaWRlcycsIGZiRGIuY29sbGVjdGlvbigndmVuZG9yX292ZXJyaWRlcycpLmdldCgpXSxcbiAgICAgIFsnY3VzdG9tX3JvdXRlcycsIGZiRGIuY29sbGVjdGlvbignY3VzdG9tX3JvdXRlcycpLmdldCgpXSxcbiAgICAgIFsnc2VndWltaWVudG9fbm90ZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ3NlZ3VpbWllbnRvX25vdGVzJykuZ2V0KCldLFxuICAgICAgWydzYXBfc25hcHNob3QnLCBmYkRiLmNvbGxlY3Rpb24oJ3NhcF9zbmFwc2hvdCcpLmdldCgpXSxcbiAgICAgIFsnZmFjdHVyYWNpb25fc25hcHNob3QnLCBmYkRiLmNvbGxlY3Rpb24oJ2ZhY3R1cmFjaW9uX3NuYXBzaG90JykuZ2V0KCldLFxuICAgICAgWydiYWNrb3JkZXJfc25hcHNob3QnLCBmYkRiLmNvbGxlY3Rpb24oJ2JhY2tvcmRlcl9zbmFwc2hvdCcpLmdldCgpXSxcbiAgICBdO1xuICAgIGNvbnN0IHByb21pc2VzID0gZmlyZXN0b3JlRW50cmllcy5tYXAoKFssIHBdKSA9PiBwKTtcbiAgICBwcm9taXNlcy5wdXNoKF9mZXRjaFN0b2NrSnNvbigpKTtcblxuICAgIGNvbnN0IHNldHRsZWQgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQocHJvbWlzZXMpO1xuICAgIC8vIFNpIENVQUxRVUlFUiBnZXQoKSBkZSBGaXJlc3RvcmUgcmVjaGF6bywgYWJvcnRhbW9zIChubyBleHBvcnQgcGFyY2lhbCBzaWxlbmNpb3NvKS5cbiAgICBjb25zdCBmYWlsZWRGaXJlc3RvcmUgPSBbXTtcbiAgICBzZXR0bGVkLnNsaWNlKDAsIGZpcmVzdG9yZUVudHJpZXMubGVuZ3RoKS5mb3JFYWNoKChyLCBpKSA9PiB7XG4gICAgICBpZiAoci5zdGF0dXMgPT09ICdyZWplY3RlZCcpXG4gICAgICAgIGZhaWxlZEZpcmVzdG9yZS5wdXNoKFxuICAgICAgICAgIGZpcmVzdG9yZUVudHJpZXNbaV1bMF0gKyAnOiAnICsgKChyLnJlYXNvbiAmJiByLnJlYXNvbi5tZXNzYWdlKSB8fCByLnJlYXNvbilcbiAgICAgICAgKTtcbiAgICB9KTtcbiAgICBpZiAoZmFpbGVkRmlyZXN0b3JlLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAnRmlyZXN0b3JlIGZldGNoIGZhbGxvIGVuICcgK1xuICAgICAgICAgIGZhaWxlZEZpcmVzdG9yZS5sZW5ndGggK1xuICAgICAgICAgICcgY29sZWNjaW9uZXM6XFxuJyArXG4gICAgICAgICAgZmFpbGVkRmlyZXN0b3JlLmpvaW4oJ1xcbicpXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIDIpIEV4dHJhZXIgc25hcHNob3RzICsgZG9jcyBjb24gX2lkXG4gICAgY29uc3Qgc25hcHNob3RzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBhbnlbXT59ICovICh7fSk7XG4gICAgZmlyZXN0b3JlRW50cmllcy5mb3JFYWNoKChbbmFtZV0sIGkpID0+IHtcbiAgICAgIGNvbnN0IHNuYXAgPSAvKiogQHR5cGUge2FueX0gKi8gKHNldHRsZWRbaV0pLnZhbHVlO1xuICAgICAgY29uc3QgZG9jcyA9IFtdO1xuICAgICAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICAgICAgZGF0YS5faWQgPSBkLmlkO1xuICAgICAgICBkb2NzLnB1c2goZGF0YSk7XG4gICAgICB9KTtcbiAgICAgIHNuYXBzaG90c1tuYW1lXSA9IGRvY3M7XG4gICAgfSk7XG4gICAgY29uc3Qgc3RvY2tKc29uID0gLyoqIEB0eXBlIHthbnl9ICovIChzZXR0bGVkW3NldHRsZWQubGVuZ3RoIC0gMV0pLnZhbHVlOyAvLyBwdWVkZSBzZXIgbnVsbFxuXG4gICAgLy8gMykgQ29uc3RydWlyIENTVnMgY29uIHJvdyBidWlsZGVycyArIHNjaGVtYXNcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ1NlcmlhbGl6YW5kbyBDU1ZzLi4uJywgNTUpO1xuICAgIGNvbnN0IGNzdnMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovICh7fSk7XG4gICAgY29uc3Qgcm93Q291bnRzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqLyAoe30pO1xuICAgIGNvbnN0IGFsbFJvd3NCeUNzdiA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYW55W11bXT59ICovICh7fSk7XG5cbiAgICBmb3IgKGNvbnN0IGNvbGxOYW1lIG9mIE9iamVjdC5rZXlzKHNuYXBzaG90cykpIHtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IERBVEFTRVRfU0NIRU1BU1tjb2xsTmFtZV07XG4gICAgICBpZiAoIXNjaGVtYSkgY29udGludWU7XG4gICAgICBjb25zdCBidWlsZGVyID0gUk9XX0JVSUxERVJTW2NvbGxOYW1lXTtcbiAgICAgIGlmICghYnVpbGRlcikgY29udGludWU7XG4gICAgICBjb25zdCBhbGxSb3dzID0gLyoqIEB0eXBlIHthbnlbXVtdfSAqLyAoW10pO1xuICAgICAgZm9yIChjb25zdCBkb2Mgb2Ygc25hcHNob3RzW2NvbGxOYW1lXSkge1xuICAgICAgICBjb25zdCByb3dzRm9yRG9jID0gYnVpbGRlcihkb2MpO1xuICAgICAgICBmb3IgKGNvbnN0IHIgb2Ygcm93c0ZvckRvYykgYWxsUm93cy5wdXNoKHIpO1xuICAgICAgfVxuICAgICAgYWxsUm93c0J5Q3N2W3NjaGVtYS5uYW1lXSA9IGFsbFJvd3M7XG4gICAgICBjc3ZzW3NjaGVtYS5uYW1lXSA9IGJ1aWxkQ3N2KHNjaGVtYSwgYWxsUm93cyk7XG4gICAgICByb3dDb3VudHNbc2NoZW1hLm5hbWVdID0gYWxsUm93cy5sZW5ndGg7XG4gICAgfVxuXG4gICAgLy8gcHJvZHVjdG9zLmNzdiAoZGVzZGUgc3RvY2suanNvbiwgbm8gRmlyZXN0b3JlKVxuICAgIGNvbnN0IHByb2R1Y3Rvc1NjaGVtYSA9IERBVEFTRVRfU0NIRU1BUy5wcm9kdWN0b3M7XG4gICAgY29uc3QgcHJvZHVjdG9zUm93cyA9IHN0b2NrSnNvbiA/IGJ1aWxkUHJvZHVjdG9Sb3dzRnJvbVN0b2NrSnNvbihzdG9ja0pzb24pIDogW107XG4gICAgYWxsUm93c0J5Q3N2W3Byb2R1Y3Rvc1NjaGVtYS5uYW1lXSA9IHByb2R1Y3Rvc1Jvd3M7XG4gICAgY3N2c1twcm9kdWN0b3NTY2hlbWEubmFtZV0gPSBidWlsZENzdihwcm9kdWN0b3NTY2hlbWEsIHByb2R1Y3Rvc1Jvd3MpO1xuICAgIHJvd0NvdW50c1twcm9kdWN0b3NTY2hlbWEubmFtZV0gPSBwcm9kdWN0b3NSb3dzLmxlbmd0aDtcblxuICAgIC8vIDQpIENvbXB1dGFyIG51bGxSYXRlQnlGaWVsZCBwYXJhIGNhZGEgY2FzbyBBLUVcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0NhbGN1bGFuZG8gY2FsaWRhZCBkZWwgZGF0YXNldC4uLicsIDc1KTtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueT59ICovXG4gICAgY29uc3QgdXNlQ2FzZVdpdGhTdGF0cyA9IHt9O1xuICAgIGZvciAoY29uc3QgW2Nhc2VLZXksIHVjXSBvZiBPYmplY3QuZW50cmllcyhEQVRBU0VUX1VTRV9DQVNFX01BVFJJWCkpIHtcbiAgICAgIGNvbnN0IHN0YXRzID0gLyoqIEB0eXBlIHthbnl9ICovICh7XG4gICAgICAgIHByaW9yaXR5OiB1Yy5wcmlvcml0eSxcbiAgICAgICAgZGVzY3JpcHRpb246IHVjLmRlc2NyaXB0aW9uLFxuICAgICAgICByZXF1aXJlZEZpZWxkczogdWMucmVxdWlyZWRGaWVsZHMsXG4gICAgICAgIGpvaW5Ob3RlczogdWMuam9pbk5vdGVzLFxuICAgICAgICBudWxsUmF0ZUJ5RmllbGQ6IHt9LFxuICAgICAgICBsaW1pdGF0aW9uczogW10sXG4gICAgICB9KTtcbiAgICAgIGxldCBoYXNIaWdoTnVsbFJhdGUgPSBmYWxzZTtcbiAgICAgIGxldCBoYXNFbXB0eVJlcXVpcmVkID0gZmFsc2U7XG4gICAgICBmb3IgKGNvbnN0IFtjc3ZOYW1lLCBmaWVsZHNdIG9mIE9iamVjdC5lbnRyaWVzKHVjLnJlcXVpcmVkRmllbGRzKSkge1xuICAgICAgICBjb25zdCBzY2hlbWFGb3JDc3YgPSBPYmplY3QudmFsdWVzKERBVEFTRVRfU0NIRU1BUykuZmluZCgocykgPT4gcy5uYW1lID09PSBjc3ZOYW1lKTtcbiAgICAgICAgaWYgKCFzY2hlbWFGb3JDc3YpIHtcbiAgICAgICAgICBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKCdTY2hlbWEgbm8gZW5jb250cmFkbyBwYXJhICcgKyBjc3ZOYW1lKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByb3dzID0gYWxsUm93c0J5Q3N2W2Nzdk5hbWVdIHx8IFtdO1xuICAgICAgICBjb25zdCByYXRlcyA9IGNvbXB1dGVOdWxsUmF0ZXMoc2NoZW1hRm9yQ3N2LCByb3dzLCBmaWVsZHMpO1xuICAgICAgICBmb3IgKGNvbnN0IFtmLCByYXRlXSBvZiBPYmplY3QuZW50cmllcyhyYXRlcykpIHtcbiAgICAgICAgICBzdGF0cy5udWxsUmF0ZUJ5RmllbGRbY3N2TmFtZSArICcuJyArIGZdID0gcmF0ZTtcbiAgICAgICAgICBpZiAocm93cy5sZW5ndGggPT09IDApIGhhc0VtcHR5UmVxdWlyZWQgPSB0cnVlO1xuICAgICAgICAgIGVsc2UgaWYgKHJhdGUgPiAwLjUpIGhhc0hpZ2hOdWxsUmF0ZSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChoYXNFbXB0eVJlcXVpcmVkKSB7XG4gICAgICAgIHN0YXRzLnN0YXR1cyA9ICdFTVBUWSc7XG4gICAgICAgIHN0YXRzLmxpbWl0YXRpb25zLnB1c2goXG4gICAgICAgICAgJ0FsZ3VuYSBjb2xlY2Npb24gcmVxdWVyaWRhIGVzdGEgdmFjaWEgXHUyMDE0IGVsIGNhc28gbm8gc2UgcHVlZGUgZW50cmVuYXIgaG95IHBlcm8gZWwgc2NoZW1hIGVzdGEgbGlzdG8uJ1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChoYXNIaWdoTnVsbFJhdGUpIHtcbiAgICAgICAgc3RhdHMuc3RhdHVzID0gJ1BBUlRJQUwnO1xuICAgICAgICBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKFxuICAgICAgICAgICdBbCBtZW5vcyAxIGNhbXBvIHJlcXVlcmlkbyB0aWVuZSA+NTAlIGRlIG51bGxzIFx1MjAxNCByZXZpc2FyIHRhc2FzIGFudGVzIGRlIHVzYXIuJ1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3RhdHMuc3RhdHVzID0gJ09LJztcbiAgICAgIH1cbiAgICAgIHVzZUNhc2VXaXRoU3RhdHNbY2FzZUtleV0gPSBzdGF0cztcbiAgICB9XG5cbiAgICAvLyA1KSBNYW5pZmVzdC5qc29uXG4gICAgY29uc3QgZXhwb3J0ZWRBdCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBtYW5pZmVzdCA9IHtcbiAgICAgIGV4cG9ydGVkQXQsXG4gICAgICBhcHBWZXJzaW9uOiB0eXBlb2YgQVBQX1ZFUlNJT04gIT09ICd1bmRlZmluZWQnID8gQVBQX1ZFUlNJT04gOiAndW5rbm93bicsXG4gICAgICBzb3VyY2VQcm9qZWN0OiAnYXBwLXZlbmRlZG9yZXMtc2hpbWFubycsXG4gICAgICBleHBvcnRlZEJ5RW1haWw6IChjdXJyZW50VXNlciAmJiBjdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nLFxuICAgICAgZXhwb3J0ZWRCeVVpZDogKGN1cnJlbnRVc2VyICYmIGN1cnJlbnRVc2VyLnVpZCkgfHwgJ3Vua25vd24nLFxuICAgICAgY3N2Q29udmVudGlvbnM6IHtcbiAgICAgICAgZW5jb2Rpbmc6ICdVVEYtOCcsXG4gICAgICAgIHNlcGFyYXRvcjogJywnLFxuICAgICAgICBxdW90ZUNoYXI6ICdcIicsXG4gICAgICAgIGVzY2FwZVF1b3RlOiAnXCJcIicsXG4gICAgICAgIGxpbmVUZXJtaW5hdG9yOiAnXFxcXHJcXFxcbicsXG4gICAgICAgIGRhdGVGb3JtYXQ6ICdJU08gODYwMSBVVEMgKHdpdGggWiknLFxuICAgICAgICBkZWNpbWFsU2VwYXJhdG9yOiAnLicsXG4gICAgICAgIG51bGxSZXByZXNlbnRhdGlvbjogJyhlbXB0eSBmaWVsZCknLFxuICAgICAgICBhcnJheUZvcm1hdDogJ0pTT04gc3RyaW5naWZpZWQnLFxuICAgICAgICBvYmplY3RGb3JtYXQ6ICdKU09OIHN0cmluZ2lmaWVkJyxcbiAgICAgIH0sXG4gICAgICByb3dDb3VudHMsXG4gICAgICBzY2hlbWE6IHt9LFxuICAgICAgdXNlQ2FzZU1hdHJpeDogdXNlQ2FzZVdpdGhTdGF0cyxcbiAgICAgIGV4Y2x1c2lvbnM6IHtcbiAgICAgICAgbm90ZTogJ0RhdG9zIHNlbnNpYmxlcyB5IGJpbmFyaW9zIGV4Y2x1aWRvcyBkZWwgZXhwb3J0LicsXG4gICAgICAgIC8vIHY3MzIgKDIwMjYtMDgtMjkpOiBzYXBfc25hcHNob3QgeWEgTk8gc2UgZXhjbHV5ZSAoYWdyZWdhZG8gY29tbyBmdWVudGVcbiAgICAgICAgLy8gZGUgdmVyZGFkIGRlIGZhY3R1cmFjaW9uIHJlYWwpLiBmYWN0dXJhY2lvbl9zbmFwc2hvdCB5IGJhY2tvcmRlcl9zbmFwc2hvdFxuICAgICAgICAvLyB0YW1wb2NvIGVyYW4gcGFydGUgZGUgZXN0YSBsaXN0YSBwZXJvIGFob3JhIHNvbiBpbmNsdWlkYXMgZXhwbGljaXRhbWVudGUuXG4gICAgICAgIGV4Y2x1ZGVkQ29sbGVjdGlvbnM6IFsncm9sZXMnLCAnYXBwX2NvbmZpZycsICdub3RpZmljYXRpb25zJywgJ29wZXJhdGlvbnNfbG9nJ10sXG4gICAgICAgIGV4Y2x1ZGVkRmllbGRzOiBbXG4gICAgICAgICAgJ3Zpc2l0cy5mcmVudGVMb2NhbCAoZm90b3MgYmFzZTY0KScsXG4gICAgICAgICAgJ3Zpc2l0cy5lc3BhY2lvW10gKGZvdG9zIGJhc2U2NCknLFxuICAgICAgICAgICdjbGllbnRfYXBwbGljYXRpb25zLmNvbnN0YW5jaWFBcmNhIChiYXNlNjQpJyxcbiAgICAgICAgICAnY2xpZW50X2FwcGxpY2F0aW9ucy5jb25zdGFuY2lhSUlCQiAoYmFzZTY0KScsXG4gICAgICAgICAgJ2NsaWVudF9hcHBsaWNhdGlvbnMuZm90b3NMb2NhbFtdIChiYXNlNjQpJyxcbiAgICAgICAgICAncmVuZGljaW9uZXMuZm90b1RpY2tldCAoYmFzZTY0IGxlZ2FjeSBwcmUtdjMwODsgc2UgZXhwb3J0YSBzb2xvIGZvdG9UaWNrZXRVcmwpJyxcbiAgICAgICAgXSxcbiAgICAgICAgc3RvY2tKc29uTG9hZGVkOiBzdG9ja0pzb24gIT09IG51bGwsXG4gICAgICB9LFxuICAgIH07XG4gICAgZm9yIChjb25zdCBbX2NvbGxOYW1lLCBzY2hlbWFdIG9mIE9iamVjdC5lbnRyaWVzKERBVEFTRVRfU0NIRU1BUykpIHtcbiAgICAgIG1hbmlmZXN0LnNjaGVtYVtzY2hlbWEubmFtZV0gPSBzY2hlbWEuY29sdW1ucy5tYXAoKGMpID0+ICh7XG4gICAgICAgIGNvbDogYy5jb2wsXG4gICAgICAgIHR5cGU6IGMudHlwZSxcbiAgICAgICAgZGVzYzogYy5kZXNjLFxuICAgICAgfSkpO1xuICAgIH1cblxuICAgIC8vIDYpIEVtcGFxdWV0YXIgWklQXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdFbXBhcXVldGFuZG8gWklQLi4uJywgOTApO1xuICAgIGNvbnN0IHppcCA9IG5ldyBKU1ppcCgpO1xuICAgIGZvciAoY29uc3QgW25hbWUsIGNvbnRlbnRdIG9mIE9iamVjdC5lbnRyaWVzKGNzdnMpKSB7XG4gICAgICB6aXAuZmlsZShuYW1lLCBjb250ZW50KTtcbiAgICB9XG4gICAgemlwLmZpbGUoJ21hbmlmZXN0Lmpzb24nLCBKU09OLnN0cmluZ2lmeShtYW5pZmVzdCwgbnVsbCwgMikpO1xuXG4gICAgY29uc3QgYmxvYiA9IGF3YWl0IHppcC5nZW5lcmF0ZUFzeW5jKHtcbiAgICAgIHR5cGU6ICdibG9iJyxcbiAgICAgIGNvbXByZXNzaW9uOiAnREVGTEFURScsXG4gICAgICBjb21wcmVzc2lvbk9wdGlvbnM6IHsgbGV2ZWw6IDYgfSxcbiAgICB9KTtcbiAgICBjb25zdCBmaWxlbmFtZSA9ICdzaGltYW5vLWRhdGFzZXQtJyArIGV4cG9ydGVkQXQucmVwbGFjZSgvWzouXS9nLCAnLScpICsgJy56aXAnO1xuICAgIF9kb3dubG9hZEJsb2IoYmxvYiwgZmlsZW5hbWUpO1xuXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKFxuICAgICAgJ0RhdGFzZXQgZGVzY2FyZ2FkbzogJyArXG4gICAgICAgIGZpbGVuYW1lICtcbiAgICAgICAgJyAoJyArXG4gICAgICAgIE9iamVjdC5rZXlzKGNzdnMpLmxlbmd0aCArXG4gICAgICAgICcgQ1NWcyArIG1hbmlmZXN0Lmpzb24pJyxcbiAgICAgIDEwMFxuICAgICk7XG4gICAgaWYgKHR5cGVvZiBzaG93U3luY1RhZyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY29uc3QgdG90YWxSb3dzID0gT2JqZWN0LnZhbHVlcyhyb3dDb3VudHMpLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xuICAgICAgc2hvd1N5bmNUYWcoXG4gICAgICAgICdEYXRhc2V0IGV4cG9ydGFkbzogJyArIHRvdGFsUm93cyArICcgZmlsYXMgZW4gJyArIE9iamVjdC5rZXlzKGNzdnMpLmxlbmd0aCArICcgQ1NWcydcbiAgICAgICk7XG4gICAgfVxuICAgIHNldFRpbWVvdXQoKCkgPT4gd2luZG93LmNsb3NlRXhwb3J0Rm9ybWF0TW9kYWwoKSwgMzAwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbZXhwb3J0RGF0YXNldFppcF0gZmF0YWw6JywgZSk7XG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdFcnJvcjogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpLCAwKTtcbiAgICBhbGVydChcbiAgICAgICdFcnJvciBhbCBleHBvcnRhciBlbCBkYXRhc2V0OlxcblxcbicgK1xuICAgICAgICAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSArXG4gICAgICAgICdcXG5cXG5FbCBaSVAgTk8gc2UgZGVzY2FyZ28gKGV2aXRhbW9zIGdlbmVyYXIgdW4gYXJjaGl2byBwYXJjaWFsKS4gUmV2aXNhIGxhIGNvbnNvbGEgcGFyYSBtYXMgZGV0YWxsZXMuJ1xuICAgICk7XG4gIH1cbn07XG5cbi8vID09PSBFeHBvcnRzIGEgd2luZG93ID09PVxuLy8gVG9kYXMgbGFzIGZ1bmNpb25lcyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgZXN0XHUwMEUxbiB2ZXJiYXRpbS5cbmlmICh0eXBlb2Ygd2luZG93LnRvZGF5U3RyID09PSAndW5kZWZpbmVkJykgd2luZG93LnRvZGF5U3RyID0gdG9kYXlTdHI7XG4vLyBFNiBob3RmaXggMjogZGF0YVVybFRvQmxvYiArIHNhbml0aXplRm9yUGF0aCB1c2Fkb3MgcG9yIGlubGluZSBydW5GdWxsQmFja3VwIChMNzI3OC03Mjg4KS5cbmlmICh0eXBlb2Ygd2luZG93LmRhdGFVcmxUb0Jsb2IgPT09ICd1bmRlZmluZWQnKSB3aW5kb3cuZGF0YVVybFRvQmxvYiA9IGRhdGFVcmxUb0Jsb2I7XG5pZiAodHlwZW9mIHdpbmRvdy5zYW5pdGl6ZUZvclBhdGggPT09ICd1bmRlZmluZWQnKSB3aW5kb3cuc2FuaXRpemVGb3JQYXRoID0gc2FuaXRpemVGb3JQYXRoO1xuLy8gRTYgaG90Zml4IDM6IGNyb3NzLW1vZHVsZSBidWcgKGF1ZGl0IGNyb3NzYnVuZGxlKSBcdTIwMTQgZXhwb3J0cy1jb3JlIGxsYW1hIGxvYWRFeGNlbEpTLlxud2luZG93LmxvYWRFeGNlbEpTID0gbG9hZEV4Y2VsSlM7XG4iXSwKICAibWFwcGluZ3MiOiAi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
