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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1hZHZhbmNlZC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXHJcbi8qKlxyXG4gKiBDU1Ygc2VyaWFsaXplciArIGRhdGFzZXQgc2NoZW1hcyArIHJvdyBidWlsZGVycyBcdTIwMTQgcGFyYSBleHBvcnREYXRhc2V0WmlwXHJcbiAqICh2MzcxKykuIEZ1bmNpb25lcyBwdXJhcywgdGVzdGVhYmxlcyBzaW4gZ2xvYmFscyBkZWwgYnVuZGxlLlxyXG4gKlxyXG4gKiA1IGNhc29zIGRlIHVzbyBNTCBkb2N1bWVudGFkb3MgZW4gREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVg6XHJcbiAqICAgQSkgQ29udmVyc2lvbiB2aXNpdGEtPnBlZGlkbyAocHJpb3JpZGFkIDEsIGNsYXNpZmljYWNpb24pXHJcbiAqICAgQikgUmllc2dvIGRlIGNodXJuIGRlIGNsaWVudGVzIChwcmlvcmlkYWQgMiwgYWxlcnRhKVxyXG4gKiAgIEMpIEZvcmVjYXN0IGRlIGRlbWFuZGEgcG9yIFNLVSAocHJpb3JpZGFkIDMsIHNlcmllcyB0ZW1wb3JhbGVzKVxyXG4gKiAgIEQpIEFub21hbGlhcyBlbiByZW5kaWNpb25lcyAoZXhwbG9yYXRvcmlvKVxyXG4gKiAgIEUpIEVzdGFjaW9uYWxpZGFkIHBvciB6b25hL2NhbXBhbmEgKGV4cGxvcmF0b3JpbylcclxuICpcclxuICogQ29udmVuY2lvbmVzIChSRkMgNDE4MCArIGFkYXB0YWNpb25lcyBwYXJhIE1MIHBpcGVsaW5lcyk6XHJcbiAqICAgLSBTZXBhcmF0b3I6IFwiLFwiXHJcbiAqICAgLSBRdW90ZSBjaGFyOiBcIlxcXCJcIlxyXG4gKiAgIC0gRXNjYXBlIHF1b3RlOiBcIlxcXCJcXFwiXCJcclxuICogICAtIExpbmUgdGVybWluYXRvcjogXCJcXHJcXG5cIlxyXG4gKiAgIC0gRW5jb2Rpbmc6IFVURi04IChCT00gb3BjaW9uYWwgYWwgZXNjcmliaXIgZWwgWklQKVxyXG4gKiAgIC0gRmVjaGFzOiBJU08gODYwMSBVVEMgKGNvbiBcIlpcIiBhbCBmaW5hbClcclxuICogICAtIERlY2ltYWxlczogcHVudG8gKFwiLlwiKVxyXG4gKiAgIC0gTnVsbC91bmRlZmluZWQ6IGNhbXBvIHZhY2lvIChOTyBcIk4vQVwiLCBcIi1cIiwgXCJudWxsXCIpXHJcbiAqICAgLSBBcnJheXMgLT4gSlNPTi5zdHJpbmdpZnkgZW50cmUgY29taWxsYXMgZG9ibGVzXHJcbiAqICAgLSBPYmpldG9zIChleGNlcHRvIFRpbWVzdGFtcCB5IERhdGUpIC0+IEpTT04uc3RyaW5naWZ5XHJcbiAqICAgLSBGaXJlc3RvcmUgVGltZXN0YW1wcyAtPiB0b0RhdGUoKS50b0lTT1N0cmluZygpXHJcbiAqL1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEhlbHBlcnMgQ1NWIHB1cm9zXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuLyoqXHJcbiAqIEVzY2FwYSB1biB2YWxvciBzdHJpbmcgcGFyYSBDU1YgUkZDIDQxODAuIFdyYXBwZWEgY29uIFwiLi4uXCIgc2kgY29udGllbmVcclxuICogXCIsXCIsIFwiXFxcIlwiLCBcIlxcclwiIG8gXCJcXG5cIi4gRXNjYXBhIFwiXFxcIlwiIC0+IFwiXFxcIlxcXCJcIi5cclxuICogQHBhcmFtIHtzdHJpbmd9IHNcclxuICogQHJldHVybnMge3N0cmluZ31cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBjc3ZFc2NhcGUocykge1xyXG4gIGlmIChzID09PSBudWxsIHx8IHMgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xyXG4gIGNvbnN0IHN0ciA9IFN0cmluZyhzKTtcclxuICBpZiAoc3RyID09PSAnJykgcmV0dXJuICcnO1xyXG4gIC8vIE5lY2VzaXRhIHF1b3Rpbmcgc2kgdGllbmUgY29tYSwgcXVvdGUsIG8gbGluZS1icmVha1xyXG4gIGlmICgvW1wiLFxcclxcbl0vLnRlc3Qoc3RyKSkge1xyXG4gICAgcmV0dXJuICdcIicgKyBzdHIucmVwbGFjZSgvXCIvZywgJ1wiXCInKSArICdcIic7XHJcbiAgfVxyXG4gIHJldHVybiBzdHI7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDb252aWVydGUgdW4gYXJyYXkgZGUgdmFsb3JlcyBlbiB1bmEgbGluZWEgQ1NWIChzaW4gdHJhaWxpbmcgbmV3bGluZSkuXHJcbiAqIEFwbGljYSBjc3ZFc2NhcGUgYSBjYWRhIGNhbXBvIGRlc3B1ZXMgZGUgZmlyZXN0b3JlVmFsdWVUb0Nzdi5cclxuICogQHBhcmFtIHt1bmtub3duW119IGZpZWxkc1xyXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGNzdlJvdyhmaWVsZHMpIHtcclxuICByZXR1cm4gZmllbGRzLm1hcCgoZikgPT4gY3N2RXNjYXBlKGZpcmVzdG9yZVZhbHVlVG9Dc3YoZikpKS5qb2luKCcsJyk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDb252aWVydGUgdW4gdmFsb3IgZGUgRmlyZXN0b3JlL0pTIGEgc3RyaW5nIGFwdG8gcGFyYSBDU1YuXHJcbiAqIFJlZ2xhIHBvciB0aXBvOlxyXG4gKiAgIC0gbnVsbCAvIHVuZGVmaW5lZCAtPiAnJ1xyXG4gKiAgIC0gRmlyZXN0b3JlIFRpbWVzdGFtcCAodGllbmUgLnRvRGF0ZSkgLT4gSVNPIDg2MDEgVVRDXHJcbiAqICAgLSBEYXRlIC0+IElTTyA4NjAxIFVUQ1xyXG4gKiAgIC0gYm9vbGVhbiAtPiAndHJ1ZScgLyAnZmFsc2UnXHJcbiAqICAgLSBudW1iZXIgLT4gU3RyaW5nKG4pIGNvbiBwdW50byBkZWNpbWFsXHJcbiAqICAgLSBzdHJpbmcgLT4gdGFsIGN1YWwgKGNzdkVzY2FwZSB3cmFwcGVhIHNpIGhhY2UgZmFsdGEpXHJcbiAqICAgLSBBcnJheSAtPiBKU09OLnN0cmluZ2lmeVxyXG4gKiAgIC0gT2JqZWN0IC0+IEpTT04uc3RyaW5naWZ5XHJcbiAqIEBwYXJhbSB7dW5rbm93bn0gdlxyXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGZpcmVzdG9yZVZhbHVlVG9Dc3Yodikge1xyXG4gIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xyXG4gIGlmICh0eXBlb2YgdiA9PT0gJ3N0cmluZycpIHJldHVybiB2O1xyXG4gIGlmICh0eXBlb2YgdiA9PT0gJ251bWJlcicpIHtcclxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHYpKSByZXR1cm4gJyc7IC8vIE5hTiwgSW5maW5pdHkgLT4gdmFjaW8gKG5vIGNvbmZ1bmRpciBwaXBlbGluZXMpXHJcbiAgICByZXR1cm4gU3RyaW5nKHYpO1xyXG4gIH1cclxuICBpZiAodHlwZW9mIHYgPT09ICdib29sZWFuJykgcmV0dXJuIHYgPyAndHJ1ZScgOiAnZmFsc2UnO1xyXG4gIC8vIEZpcmVzdG9yZSBUaW1lc3RhbXBcclxuICBpZiAoXHJcbiAgICB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiZcclxuICAgIHYgIT09IG51bGwgJiZcclxuICAgIHR5cGVvZiAoLyoqIEB0eXBlIHthbnl9ICovICh2KS50b0RhdGUpID09PSAnZnVuY3Rpb24nXHJcbiAgKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHthbnl9ICovICh2KS50b0RhdGUoKS50b0lTT1N0cmluZygpO1xyXG4gICAgfSBjYXRjaCAoXykge1xyXG4gICAgICByZXR1cm4gJyc7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGlmICh2IGluc3RhbmNlb2YgRGF0ZSkge1xyXG4gICAgaWYgKE51bWJlci5pc05hTih2LmdldFRpbWUoKSkpIHJldHVybiAnJztcclxuICAgIHJldHVybiB2LnRvSVNPU3RyaW5nKCk7XHJcbiAgfVxyXG4gIGlmIChBcnJheS5pc0FycmF5KHYpKSB7XHJcbiAgICAvLyBKU09OLnN0cmluZ2lmeSBkZSBhcnJheS4gY3N2RXNjYXBlIGx1ZWdvIGxvIHdyYXBwZWEgc2kgaGF5IGNvbWFzLlxyXG4gICAgdHJ5IHtcclxuICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHYpO1xyXG4gICAgfSBjYXRjaCAoXykge1xyXG4gICAgICByZXR1cm4gJyc7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGlmICh0eXBlb2YgdiA9PT0gJ29iamVjdCcpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTtcclxuICAgIH0gY2F0Y2ggKF8pIHtcclxuICAgICAgcmV0dXJuICcnO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gU3RyaW5nKHYpO1xyXG59XHJcblxyXG4vKipcclxuICogT2J0aWVuZSBlbCB2YWxvciBkZSB1biBwYXRoIGRvdC1ub3RhdGlvbiBlbiB1biBvYmpldG8gYW5pZGFkby5cclxuICogRWo6IGdldFBhdGgoe2E6IHtiOiB7YzogMX19fSwgJ2EuYi5jJykgLT4gMVxyXG4gKiBnZXRQYXRoKHt9LCAnYS5iJykgLT4gdW5kZWZpbmVkXHJcbiAqIEBwYXJhbSB7b2JqZWN0fSBvYmpcclxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGhcclxuICogQHJldHVybnMge3Vua25vd259XHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gZ2V0UGF0aChvYmosIHBhdGgpIHtcclxuICBpZiAoIW9iaiB8fCAhcGF0aCkgcmV0dXJuIHVuZGVmaW5lZDtcclxuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy4nKTtcclxuICBsZXQgY3VyID0gLyoqIEB0eXBlIHthbnl9ICovIChvYmopO1xyXG4gIGZvciAoY29uc3QgcCBvZiBwYXJ0cykge1xyXG4gICAgaWYgKGN1ciA9PT0gbnVsbCB8fCBjdXIgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIGN1ciA9IGN1cltwXTtcclxuICB9XHJcbiAgcmV0dXJuIGN1cjtcclxufVxyXG5cclxuLyoqXHJcbiAqIENvbnN0cnV5ZSBlbCBDU1YgY29tcGxldG8gKGhlYWRlciArIE4gcm93cykgcGFyYSB1bmEgY29sZWNjaW9uIHNlZ3VuXHJcbiAqIHN1IHNjaGVtYS4gQ2FkYSBidWlsZGVyIGRldnVlbHZlIHVuIGFycmF5IGRlIGZpbGFzIChjYWRhIGZpbGEgPSBhcnJheVxyXG4gKiBkZSB2YWxvcmVzIGVuIGVsIG9yZGVuIGRlbCBzY2hlbWEpLlxyXG4gKiBAcGFyYW0ge3tjb2x1bW5zOiB7Y29sOiBzdHJpbmd9W119fSBzY2hlbWFcclxuICogQHBhcmFtIHt1bmtub3duW11bXX0gcm93c1xyXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBDU1YgY29tcGxldG8gY29uIFxcclxcbiBjb21vIGxpbmUgc2VwYXJhdG9yXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDc3Yoc2NoZW1hLCByb3dzKSB7XHJcbiAgY29uc3QgaGVhZGVyID0gc2NoZW1hLmNvbHVtbnMubWFwKChjKSA9PiBjc3ZFc2NhcGUoYy5jb2wpKS5qb2luKCcsJyk7XHJcbiAgY29uc3QgYm9keSA9IHJvd3MubWFwKChyKSA9PiBjc3ZSb3cocikpLmpvaW4oJ1xcclxcbicpO1xyXG4gIHJldHVybiBib2R5Lmxlbmd0aCA/IGhlYWRlciArICdcXHJcXG4nICsgYm9keSArICdcXHJcXG4nIDogaGVhZGVyICsgJ1xcclxcbic7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDdWVudGEgbnVsbCByYXRlIHBvciBjb2x1bW5hIHJlcXVlcmlkYS4gUmV0b3JuYVxyXG4gKiB7Y29sTmFtZTogcmF0ZSAwLi4xfS4gVW4gdmFsb3IgZXMgXCJudWxsXCIgc2kgZmlyZXN0b3JlVmFsdWVUb0NzdiBkZXZ1ZWx2ZSAnJy5cclxuICogQHBhcmFtIHt7Y29sdW1uczoge2NvbDogc3RyaW5nfVtdfX0gc2NoZW1hXHJcbiAqIEBwYXJhbSB7dW5rbm93bltdW119IHJvd3NcclxuICogQHBhcmFtIHtzdHJpbmdbXX0gcmVxdWlyZWRDb2xzXHJcbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVOdWxsUmF0ZXMoc2NoZW1hLCByb3dzLCByZXF1aXJlZENvbHMpIHtcclxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXHJcbiAgY29uc3QgcmVzdWx0ID0ge307XHJcbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xyXG4gICAgLy8gc2luIGRhdG9zOiBudWxsIHJhdGUgPSAxICgxMDAlIGZhbHRhKSBwYXJhIGNhZGEgY2FtcG8gcmVxdWVyaWRvXHJcbiAgICBmb3IgKGNvbnN0IGMgb2YgcmVxdWlyZWRDb2xzKSByZXN1bHRbY10gPSAxO1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcbiAgY29uc3QgY29sSW5kZXggPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSk7XHJcbiAgc2NoZW1hLmNvbHVtbnMuZm9yRWFjaCgoYywgaSkgPT4ge1xyXG4gICAgY29sSW5kZXhbYy5jb2xdID0gaTtcclxuICB9KTtcclxuICBmb3IgKGNvbnN0IHJjIG9mIHJlcXVpcmVkQ29scykge1xyXG4gICAgY29uc3QgaWR4ID0gY29sSW5kZXhbcmNdO1xyXG4gICAgaWYgKGlkeCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHJlc3VsdFtyY10gPSAxOyAvLyBjb2x1bW5hIG5vIGV4aXN0ZSBlbiBzY2hlbWEgLT4gY29uc2lkZXJhciBjb21vIDEwMCUgbnVsbFxyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGxldCBudWxscyA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XHJcbiAgICAgIGNvbnN0IHYgPSByb3dbaWR4XTtcclxuICAgICAgaWYgKGZpcmVzdG9yZVZhbHVlVG9Dc3YodikgPT09ICcnKSBudWxscysrO1xyXG4gICAgfVxyXG4gICAgcmVzdWx0W3JjXSA9IE1hdGgucm91bmQoKG51bGxzIC8gcm93cy5sZW5ndGgpICogMTAwMDApIC8gMTAwMDA7XHJcbiAgfVxyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBEQVRBU0VUX1NDSEVNQVMgXHUyMDE0IDExIGNvbGVjY2lvbmVzIGNvbiBjb2x1bW5hcyArIHRpcG9zICsgZGVzY3JpcGNpb25lc1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8qKiBAdHlwZWRlZiB7e2NvbDogc3RyaW5nLCB0eXBlOiBzdHJpbmcsIGRlc2M6IHN0cmluZ319IFNjaGVtYUNvbHVtbiAqL1xyXG4vKiogQHR5cGVkZWYge3tuYW1lOiBzdHJpbmcsIHNvdXJjZTogJ2ZpcmVzdG9yZSd8J3N0b2NrX2pzb24nLCBjb2xsZWN0aW9uPzogc3RyaW5nLCByb3dNb2RlOiBzdHJpbmcsIGNvbHVtbnM6IFNjaGVtYUNvbHVtbltdfX0gRGF0YXNldFNjaGVtYSAqL1xyXG5cclxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBEYXRhc2V0U2NoZW1hPn0gKi9cclxuZXhwb3J0IGNvbnN0IERBVEFTRVRfU0NIRU1BUyA9IHtcclxuICBwZWRpZG9zOiB7XHJcbiAgICBuYW1lOiAncGVkaWRvcy5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICdwZWRpZG9zJyxcclxuICAgIHJvd01vZGU6ICdmbGF0dGVuX2xpbmVzJywgLy8gMSBmaWxhIHBvciAocGVkaWRvLCBsaW5lYSlcclxuICAgIGNvbHVtbnM6IFtcclxuICAgICAgeyBjb2w6ICdwZWRpZG9faWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXHJcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGVsIHZlbmRlZG9yIGR1ZW5pbyBkZWwgcGVkaWRvJyB9LFxyXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlbWFpbCBkZWwgdmVuZGVkb3InIH0sXHJcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9ieV91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3F1aWVuIGNhcmdvIChWREkgcHVlZGUgY2FyZ2FyIHBvciBWREUpJyB9LFxyXG4gICAgICB7IGNvbDogJ29uX2JlaGFsZl9vZicsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWUgc2kgVkRJIGNhcmdvIHBvciBWREUnIH0sXHJcbiAgICAgIHsgY29sOiAna2V5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdjbGF2ZSBjb21wdWVzdGEgdGlwb3xwcm92fGxvY3xjbGllbnRlJyB9LFxyXG4gICAgICB7IGNvbDogJ3N0YWdlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwZW5kaW5nIHwgY29uZmlybWVkIHwgc2FwX2ltcG9ydGVkJyB9LFxyXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0M9Y2xpZW50ZSB8IFA9cHJvc3BlY3RvJyB9LFxyXG4gICAgICB7IGNvbDogJ3Byb3ZpbmNlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwcm92aW5jaWEnIH0sXHJcbiAgICAgIHsgY29sOiAnbG9jX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2xvY2FsaWRhZCcgfSxcclxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNsaWVudGUnIH0sXHJcbiAgICAgIHsgY29sOiAnbW9udGgnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFwiSnVsaW8gMjAyNlwiJyB9LFxyXG4gICAgICB7IGNvbDogJ21vbnRoX2lkeCcsIHR5cGU6ICdpbnQnLCBkZXNjOiAnMC0xMScgfSxcclxuICAgICAgeyBjb2w6ICd5ZWFyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdhbm8nIH0sXHJcbiAgICAgIHsgY29sOiAnY29uZmlybWVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQyBkZSBjb25maXJtYWNpb24nIH0sXHJcbiAgICAgIHsgY29sOiAnY29uZGljaW9uX3BhZ28nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIENUQSBDVEUnIH0sXHJcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdUUkFOU1BPUlRJU1RBIHwgU1VDVVJTQUwnIH0sXHJcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV90cmFuc3Bfbm9tYnJlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV90cmFuc3BfZGlyZWNjaW9uJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9jbGllbnRlX2RpcmVjY2lvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGVzdGlubyBmaW5hbCcgfSxcclxuICAgICAgeyBjb2w6ICdmb3JtYV9lbnRyZWdhX3N1Y3Vyc2FsX2RpcmVjY2lvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAnZGlzY291bnRfcGN0JyxcclxuICAgICAgICB0eXBlOiAnbnVtYmVyJyxcclxuICAgICAgICBkZXNjOiAnZGVzY3VlbnRvIHRvdGFsIGRlbCBwZWRpZG8gKGFwbGljYWRvIGEgbml2ZWwgaGVhZGVyLCBwcm9ycmF0ZWFyIGVuIHBpcGVsaW5lKScsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAnc3VidG90YWxfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdzdWJ0b3RhbCBicnV0byBBUlMnIH0sXHJcbiAgICAgIHsgY29sOiAnbmV0X2Ftb3VudF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ25ldG8gQVJTIHBvc3QtZGVzY3VlbnRvJyB9LFxyXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF92aWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2R0d19tYW51YWwgfCBzZXJ2aWNlX2xheWVyJyB9LFxyXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF9kb2NfbnVtJywgdHlwZTogJ2ludCcsIGRlc2M6ICdudW1lcm8gZGUgUXVvdGF0aW9uIFNBUCcgfSxcclxuICAgICAgeyBjb2w6ICd0cmFuc2Zlcmlkb19zYXBfZG9jX2VudHJ5JywgdHlwZTogJ2ludCcsIGRlc2M6ICdkb2MgZW50cnkgaW50ZXJubyBTQVAnIH0sXHJcbiAgICAgIHsgY29sOiAndHJhbnNmZXJpZG9fc2FwX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcclxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcclxuICAgICAgeyBjb2w6ICdsaW5lX2luZGV4JywgdHlwZTogJ2ludCcsIGRlc2M6ICdpbmRpY2UgZGUgbGluZWEgMC1iYXNlZCcgfSxcclxuICAgICAgeyBjb2w6ICdsaW5lX2NvZGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVScgfSxcclxuICAgICAgeyBjb2w6ICdsaW5lX2Rlc2MnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2Rlc2NyaXBjaW9uIHByb2R1Y3RvJyB9LFxyXG4gICAgICB7IGNvbDogJ2xpbmVfcXR5JywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdjYW50aWRhZCcgfSxcclxuICAgICAgeyBjb2w6ICdsaW5lX3ByZWNpbycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAncHJlY2lvIHVuaXRhcmlvIEFSUycgfSxcclxuICAgICAgeyBjb2w6ICdsaW5lX2NhdCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2F0ZWdvcmlhJyB9LFxyXG4gICAgICB7IGNvbDogJ2xpbmVfZmFtJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdmYW1pbGlhJyB9LFxyXG4gICAgICB7IGNvbDogJ2xpbmVfc3ViJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzdWJmYW1pbGlhJyB9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIHZpc2l0YXM6IHtcclxuICAgIG5hbWU6ICd2aXNpdGFzLmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ3Zpc2l0cycsXHJcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7IGNvbDogJ3Zpc2l0X2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxyXG4gICAgICB7IGNvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIGRlbCB2ZW5kZWRvcicgfSxcclxuICAgICAgeyBjb2w6ICdvd25lcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIHZlbmRlZG9yJyB9LFxyXG4gICAgICB7IGNvbDogJ2ZlY2hhJywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnWVlZWS1NTS1ERCAoZmVjaGEgZGUgdmlzaXRhLCBubyBVVEMpJyB9LFxyXG4gICAgICB7IGNvbDogJ21lcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnSlVOSU8sIEpVTElPLCBldGMuJyB9LFxyXG4gICAgICB7IGNvbDogJ2FuaW8nLCB0eXBlOiAnaW50JywgZGVzYzogJ2FubycgfSxcclxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjYW5vbmljbyB2ZW5kZWRvcicgfSxcclxuICAgICAgeyBjb2w6ICdwcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Byb3ZpbmNpYScgfSxcclxuICAgICAgeyBjb2w6ICdsb2NhbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2xvY2FsaWRhZCcgfSxcclxuICAgICAgeyBjb2w6ICd0aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSB0aWVuZGEnIH0sXHJcbiAgICAgIHsgY29sOiAndGlwbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQyB8IFAnIH0sXHJcbiAgICAgIHsgY29sOiAnbG9jYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFByb3BpbywgQWxxdWlsYWRvJyB9LFxyXG4gICAgICB7IGNvbDogJ3RhbWFubycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ2hpY28sIE1lZGlhbm8sIEdyYW5kZScgfSxcclxuICAgICAgeyBjb2w6ICdmaWRlbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0FsdGEsIE1lZGlhLCBCYWphJyB9LFxyXG4gICAgICB7IGNvbDogJ3JlbGV2YW5jaWEnLCB0eXBlOiAnaW50JywgZGVzYzogJzAtNScgfSxcclxuICAgICAgeyBjb2w6ICdwb3AnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFN0aWNrZXJzIFNoaW1hbm8nIH0sXHJcbiAgICAgIHsgY29sOiAnbmVjZXNpZGFkX3B1bnR1YWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICd0aXBvX3ZlbnRhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBDYXNhIGRlIHBlc2NhICsgZWNvbW1lcmNlJyB9LFxyXG4gICAgICB7IGNvbDogJ3BvbmRlcmFjaW9uX21vc3RyYWRvJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcclxuICAgICAgeyBjb2w6ICdwb25kZXJhY2lvbl9lY29tbWVyY2UnLCB0eXBlOiAnaW50JywgZGVzYzogJzAtMTAwJyB9LFxyXG4gICAgICB7IGNvbDogJ2NvbXBldGVuY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnb3BvcnR1bmlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdtYXNfdmVuZGlkbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ21hc19wcmVndW50YW4nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdheXVkYV90aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdncHNfc3RhdHVzJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdvayB8IG91dHNpZGUgfCBub2xvYycgfSxcclxuICAgICAgeyBjb2w6ICdncHNfZGlzdGFuY2VfbScsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnbWV0cm9zJyB9LFxyXG4gICAgICB7IGNvbDogJ2ludGVyYWN0aW9uX3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Zpc2l0YSB8IGNvbnRhY3RvJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAnZm9ybWFfY29udGFjdG8nLFxyXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgIGRlc2M6ICdMTEFNQURBIFRFTEVGT05JQ0EgfCBNRU5TQUpFIERFIFdIQVRTQVBQIHwgTUVOU0FKRSBTTVMgKHNpIGNvbnRhY3RvKScsXHJcbiAgICAgIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBjb2w6ICdjb250YWN0b19yZXN1bHRhZG8nLFxyXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgIGRlc2M6ICdyZXNwb25kaW8gfCBub19yZXNwb25kaW8gfCB2YWNpbyAoc2luIG1hcmNhciwgc29sbyBhcGxpY2EgYSBjb250YWN0byknLFxyXG4gICAgICB9LFxyXG4gICAgICB7IGNvbDogJ2NvbnRhY3RvX3Jlc3VsdGFkb19hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnIH0sXHJcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGUgcXVpZW4gbWFyY28nIH0sXHJcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnIH0sXHJcbiAgICBdLFxyXG4gIH0sXHJcbiAgY2xpZW50ZXM6IHtcclxuICAgIG5hbWU6ICdjbGllbnRlcy5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICdjbGllbnRfYXBwbGljYXRpb25zJyxcclxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXHJcbiAgICBjb2x1bW5zOiBbXHJcbiAgICAgIHsgY29sOiAnYXBwX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxyXG4gICAgICB7IGNvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnb3duZXJfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2NvbWVyY2lvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdyYXpvbiBzb2NpYWwnIH0sXHJcbiAgICAgIHsgY29sOiAnZmFudGFzaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjb21lcmNpYWwnIH0sXHJcbiAgICAgIHsgY29sOiAnY3VpdCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnc29sbyBkaWdpdG9zIHBvc3QtdjI5NCcgfSxcclxuICAgICAgeyBjb2w6ICdjb25kaWNpb25fZmlzY2FsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnY2FsbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdudW1lcm8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdsb2NhbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdwcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdsb2NhbGlkYWRfZmluYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ292ZXJyaWRlIGRlbCBhcHJvYmFkb3InIH0sXHJcbiAgICAgIHsgY29sOiAnY2FyZF9jb2RlX3NhcCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQ2FyZENvZGUgU0FQJyB9LFxyXG4gICAgICB7IGNvbDogJ2Fzc2lnbmVkX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZGVkb3IgYXNpZ25hZG8gKHNvdXJjZSBvZiB0cnV0aCB2MzExKyknIH0sXHJcbiAgICAgIHsgY29sOiAnc3RhdHVzJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwZW5kaW5nX2FwcHJvdmFsIHwgYXBwcm92ZWQgfCByZWplY3RlZCcgfSxcclxuICAgICAge1xyXG4gICAgICAgIGNvbDogJ3NvdXJjZScsXHJcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgZGVzYzogJ21hbnVhbCB8IHNhcF9idWxrX2ltcG9ydCB8IGFsdGFfcmFwaWRhIHwgc2FwX3N5bmMgfCBzYXBfc3luY19tYW51YWxfbGluaycsXHJcbiAgICAgIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBjb2w6ICdtYW51YWxfc2FwX3BlbmRpbmcnLFxyXG4gICAgICAgIHR5cGU6ICdib29sZWFuJyxcclxuICAgICAgICBkZXNjOiAndHJ1ZT1wcm92aXNvcmlvIChBbHRhIFJhcGlkYSBzaW4gQ2FyZENvZGUpJyxcclxuICAgICAgfSxcclxuICAgICAgeyBjb2w6ICdwcmVjYXVjaW9uJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1jbGllbnRlIG1hcmNhZG8gcG9yIGltcGFnbycgfSxcclxuICAgICAgeyBjb2w6ICdjYXRlZ29yaWFfY2xpZW50ZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnUC9BL0IvQycgfSxcclxuICAgICAgeyBjb2w6ICdjbGlfdGlwbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQyBkZWZhdWx0IHBvc3QtdjM0OScgfSxcclxuICAgICAgeyBjb2w6ICdsYXQnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2dlb2xhdCcgfSxcclxuICAgICAgeyBjb2w6ICdsbmcnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2dlb2xuZycgfSxcclxuICAgICAgeyBjb2w6ICdoYXNfZ2VvJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAnbGF0L2xuZyBubyBudWxsJyB9LFxyXG4gICAgICB7IGNvbDogJ2hhc19hZGRyZXNzJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAnY2FsbGUgbm8gdmFjaWEnIH0sXHJcbiAgICAgIHsgY29sOiAnc3VibWl0dGVkX2J5X3B1YmxpY19mb3JtJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndmlhIGFsdGEtY2xpZW50ZS5odG1sJyB9LFxyXG4gICAgICB7IGNvbDogJ2FwcHJvdmVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgIF0sXHJcbiAgfSxcclxuICBjbGllbnRfbWFzdGVyOiB7XHJcbiAgICBuYW1lOiAnY2xpZW50X21hc3Rlci5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICdjbGllbnRfbWFzdGVyJyxcclxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXHJcbiAgICBjb2x1bW5zOiBbXHJcbiAgICAgIHsgY29sOiAnbWFzdGVyX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxyXG4gICAgICB7IGNvbDogJ2NsaWVudF9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnbG9jYWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAndmVuZG9yJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICd2ZW5kZWRvciBjdXJhZG8gYWRtaW4nIH0sXHJcbiAgICAgIHsgY29sOiAnYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIGN1cmFkYSBhZG1pbicgfSxcclxuICAgICAgeyBjb2w6ICdzYXBfY2FyZF9jb2RlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDYXJkQ29kZSBTQVAnIH0sXHJcbiAgICAgIHsgY29sOiAnc2FwX2FkZHJlc3MnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2RpcmVjY2lvbiByYXcgU0FQJyB9LFxyXG4gICAgICB7IGNvbDogJ3NhcF9jaXR5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnc2FwX3N0YXRlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnc2FwX2ltcG9ydGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3NhcF9pbXBvcnRlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2NsaWVudF9uYW1lX29yaWdpbmFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdiYWNrdXAgbm9tYnJlIHByZS1pbXBvcnQnIH0sXHJcbiAgICAgIHsgY29sOiAnbG9jYWxpZGFkX29yaWdpbmFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdiYWNrdXAgbG9jYWxpZGFkIHByZS1pbXBvcnQnIH0sXHJcbiAgICAgIHsgY29sOiAnbWF0Y2hfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZXhhY3QgfCBmdXp6eScgfSxcclxuICAgICAgeyBjb2w6ICdtYXRjaF9zaW1pbGFyaXR5JywgdHlwZTogJ251bWJlcicsIGRlc2M6ICcwLTEnIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICBdLFxyXG4gIH0sXHJcbiAgcmVuZGljaW9uZXM6IHtcclxuICAgIG5hbWU6ICdyZW5kaWNpb25lcy5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICdyZW5kaWNpb25lcycsXHJcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7IGNvbDogJ3JlbmRpY2lvbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcclxuICAgICAgeyBjb2w6ICdvd25lcl91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdvd25lcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2dhc3RvIHwgc29saWNpdHVkJyB9LFxyXG4gICAgICB7IGNvbDogJ3RpcG9fZ2FzdG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFBFQUpFUywgRkFDVFVSQSBBLCBHQVNUTyBDT04gQ09NUFJPQkFOVEUnIH0sXHJcbiAgICAgIHsgY29sOiAnaW1wb3J0ZV9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ21vbnRvIEFSUycgfSxcclxuICAgICAgeyBjb2w6ICdmZWNoYV9nYXN0bycsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ1lZWVktTU0tREQgZGVsIGdhc3RvJyB9LFxyXG4gICAgICB7IGNvbDogJ2NvbmNlcHRvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkZXNjcmlwY2lvbiBsaWJyZScgfSxcclxuICAgICAgeyBjb2w6ICdmb3RvX3RpY2tldF91cmwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VSTCBGaXJlYmFzZSBTdG9yYWdlIHYzMDgrIChudW5jYSBiYXNlNjQpJyB9LFxyXG4gICAgICB7IGNvbDogJ3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncGVuZGluZ19hcHByb3ZhbCB8IGFwcHJvdmVkIHwgcmVqZWN0ZWQnIH0sXHJcbiAgICAgIHsgY29sOiAnYXBwcm92ZWRfYnknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VtYWlsIGRlbCBhcHJvYmFkb3IgbyBcInNlbGZcIicgfSxcclxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdyZWplY3RlZF9ieV9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3JlamVjdGVkX3JlYXNvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2FwcHJvdmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIHJlc3BvbnNhYmxlIGFzaWduYWRvJyB9LFxyXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXHJcbiAgICBdLFxyXG4gIH0sXHJcbiAgY2FtcGFuaWFzOiB7XHJcbiAgICBuYW1lOiAnY2FtcGFuaWFzLmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ2NhbXBhaWducycsXHJcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7IGNvbDogJ2NhbXBhaWduX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxyXG4gICAgICB7IGNvbDogJ25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjYW1wYW5hJyB9LFxyXG4gICAgICB7IGNvbDogJ2ZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFJFRUxTJyB9LFxyXG4gICAgICB7IGNvbDogJ3N1YmZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIE1VTFRJUExJQ0FET1JFUycgfSxcclxuICAgICAgeyBjb2w6ICdmaWx0ZXJfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnc2t1IChob3kgaGFyZGNvZGVkKScgfSxcclxuICAgICAgeyBjb2w6ICdmaWx0ZXJfdmFsdWVzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdjb3BpYSBkZSBza3VzJyB9LFxyXG4gICAgICB7IGNvbDogJ3NrdXNfanNvbicsIHR5cGU6ICdqc29uX2FycmF5JywgZGVzYzogJ0l0ZW1Db2RlcyBpbmNsdWlkb3MnIH0sXHJcbiAgICAgIHsgY29sOiAnc2t1c19jb3VudCcsIHR5cGU6ICdpbnQnLCBkZXNjOiAnY2FudGlkYWQgU0tVcycgfSxcclxuICAgICAgeyBjb2w6ICd0YXJnZXRfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndW5pdHMgfCBtb25leScgfSxcclxuICAgICAgeyBjb2w6ICd0YXJnZXRfYW1vdW50JywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdvYmpldGl2bycgfSxcclxuICAgICAgeyBjb2w6ICdzdGFydF9kYXRlJywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnWVlZWS1NTS1ERCcgfSxcclxuICAgICAgeyBjb2w6ICdlbmRfZGF0ZScsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ1lZWVktTU0tREQnIH0sXHJcbiAgICAgIHsgY29sOiAnc2NvcGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2FsbCB8IHByb3ZpbmNlIHwgdmVuZG9yJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAnc2NvcGVfdmFsdWVzX2pzb24nLFxyXG4gICAgICAgIHR5cGU6ICdqc29uX2FycmF5JyxcclxuICAgICAgICBkZXNjOiAncHJvdmluY2lhcyBvIHZlbmRvciBrZXlzIHNpIHNjb3BlICE9IGFsbCcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIGFkbWluL2dlcmVudGUnIH0sXHJcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9ieV9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnYXJjaGl2ZWRfbWFudWFsbHknLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWZpbmFsaXphZGEgYW50ZXMgZGUgZW5kRGF0ZScgfSxcclxuICAgICAgeyBjb2w6ICdhcmNoaXZlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdhcmNoaXZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIHRhcmdldHM6IHtcclxuICAgIG5hbWU6ICd0YXJnZXRzLmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ3RhcmdldHMnLFxyXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcclxuICAgIGNvbHVtbnM6IFtcclxuICAgICAgeyBjb2w6ICd0YXJnZXRfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgY2Fub25pY28ge3ZlbmRvcn1fe3llYXJ9X3tNTX0nIH0sXHJcbiAgICAgIHsgY29sOiAnc2VsbGVyX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICd2ZW5kb3JLZXkgdXBwZXJjYXNlIGVqIEdPTlpBTE8gREUgTEEgUk9TQScgfSxcclxuICAgICAgeyBjb2w6ICd5ZWFyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdlaiAyMDI2JyB9LFxyXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExIChpbmRpY2UgZGVsIGFycmF5IE1FU0VTIDAtaW5kZXhlZCknIH0sXHJcbiAgICAgIHsgY29sOiAndGFyZ2V0X2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnb2JqZXRpdm8gbWVzIEFSUyAoc3VtYSBmYW1pbGlhcyknIH0sXHJcbiAgICAgIHsgY29sOiAndGFyZ2V0X3JlZWxfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICd2MzExKyBkZXNnbG9zZScgfSxcclxuICAgICAgeyBjb2w6ICd0YXJnZXRfY2FuYXNfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICd2MzExKyBkZXNnbG9zZScgfSxcclxuICAgICAgeyBjb2w6ICd0YXJnZXRfbGluZWFzX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAndjMxMSsgZGVzZ2xvc2UnIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQnIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9ieV9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIHByb2R1Y3Rvczoge1xyXG4gICAgbmFtZTogJ3Byb2R1Y3Rvcy5jc3YnLFxyXG4gICAgc291cmNlOiAnc3RvY2tfanNvbicsXHJcbiAgICByb3dNb2RlOiAnZnJvbV9zdG9ja19qc29uJyxcclxuICAgIGNvbHVtbnM6IFtcclxuICAgICAgeyBjb2w6ICdza3UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVSAoSXRlbUNvZGUgU0FQKScgfSxcclxuICAgICAgeyBjb2w6ICdoYXNfc3RvY2snLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWhheSB1bmlkYWRlcyBlbiBhbGd1biB3aHMgdmVuZGlibGUnIH0sXHJcbiAgICAgIHsgY29sOiAnY2FudGlkYWRfdG90YWwnLCB0eXBlOiAnaW50JywgZGVzYzogJ3N1bWEgdG90YWwgd2hzIHZlbmRpYmxlcyAoZXhjbHV5ZSAwNSB5IDA2KScgfSxcclxuICAgICAge1xyXG4gICAgICAgIGNvbDogJ2Rpc3BvbmlibGVfdmVudGFfd2hzMTEnLFxyXG4gICAgICAgIHR5cGU6ICdpbnQnLFxyXG4gICAgICAgIGRlc2M6ICd2MzY5KyBNZXJjYWRlcmlhIE5VUiBQRVNDQSAodmVudGEgZGlyZWN0YSknLFxyXG4gICAgICB9LFxyXG4gICAgICB7IGNvbDogJ3RyYW5zaXRvX3doczEyJywgdHlwZTogJ2ludCcsIGRlc2M6ICd2MzY5KyBFbiB0cmFuc2l0byBQRVNDQSAoYmFja29yZGVyIGZ1dHVybyknIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBjb2w6ICdvdHJvc193YXJlaG91c2VzX2pzb24nLFxyXG4gICAgICAgIHR5cGU6ICdqc29uX29iamVjdCcsXHJcbiAgICAgICAgZGVzYzogJ290cm9zIGNvZGlnb3MgY29uIGNhbnRpZGFkLCBlaiB7XCI5OFwiOiA1fScsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAnc291cmNlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzdG9jay5qc29uIHNuYXBzaG90JyB9LFxyXG4gICAgICB7IGNvbDogJ3NuYXBzaG90X3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgZGVsIHVsdGltbyBzeW5jIFNBUCcgfSxcclxuICAgIF0sXHJcbiAgfSxcclxuICB2ZW5kb3Jfb3ZlcnJpZGVzOiB7XHJcbiAgICBuYW1lOiAndmVuZG9yX292ZXJyaWRlcy5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICd2ZW5kb3Jfb3ZlcnJpZGVzJyxcclxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXHJcbiAgICBjb2x1bW5zOiBbXHJcbiAgICAgIHsgY29sOiAnb3ZlcnJpZGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXHJcbiAgICAgIHsgY29sOiAnc2NvcGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Nob3AgfCBsb2MnIH0sXHJcbiAgICAgIHsgY29sOiAncHJvdmluY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdsb2NhbGl0eV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3NvbG8gc2kgc2NvcGU9c2hvcCcgfSxcclxuICAgICAgeyBjb2w6ICdvcmlnaW5hbF92ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICduZXdfdmVuZG9yJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnbmV3X3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1ZERSB8IFZESSB8IERJU1RSSUJVSURPUiB8IE9UUk8nIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X2Rpc3BsYXlfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIGN1c3RvbV9yb3V0ZXM6IHtcclxuICAgIG5hbWU6ICdjdXN0b21fcm91dGVzLmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ2N1c3RvbV9yb3V0ZXMnLFxyXG4gICAgcm93TW9kZTogJ2ZsYXR0ZW5fc3RvcHMnLCAvLyAxIGZpbGEgcG9yIChydXRhLCBzdG9wKVxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7IGNvbDogJ3JvdXRlX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxyXG4gICAgICB7IGNvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZHVlbmlvIGRlIGxhIHJ1dGEnIH0sXHJcbiAgICAgIHsgY29sOiAnb3duZXJfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICduYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdub21icmUgZGUgbGEgcnV0YScgfSxcclxuICAgICAgeyBjb2w6ICdwbGFubmVkX2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxyXG4gICAgICB7IGNvbDogJ25vdGVzJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdub3RhcyBsaWJyZXMnIH0sXHJcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3N0b3Bfb3JkZXInLCB0eXBlOiAnaW50JywgZGVzYzogJ29yZGVuIDAtYmFzZWQnIH0sXHJcbiAgICAgIHsgY29sOiAnc3RvcF9rZXknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2NsYXZlIGNvbXB1ZXN0YSB0aXBvfHByb3Z8bG9jfGNsaWVudGUnIH0sXHJcbiAgICAgIHsgY29sOiAnc3RvcF90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIHwgUCcgfSxcclxuICAgICAgeyBjb2w6ICdzdG9wX3Byb3ZpbmNpYScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3N0b3BfbG9jYWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnc3RvcF9jbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3N0b3BfaXNfcHJvdmlzb3JpbycsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWU9YWx0YSByYXBpZGEgc2luIENhcmRDb2RlJyB9LFxyXG4gICAgICB7IGNvbDogJ3N0b3Bfc2FwX2FsdGFfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0lEIGRlbCBjbGllbnRfYXBwbGljYXRpb25zIHNpIGFwbGljYScgfSxcclxuICAgIF0sXHJcbiAgfSxcclxuICBzZWd1aW1pZW50b19ub3Rlczoge1xyXG4gICAgbmFtZTogJ3NlZ3VpbWllbnRvX25vdGVzLmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ3NlZ3VpbWllbnRvX25vdGVzJyxcclxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXHJcbiAgICBjb2x1bW5zOiBbXHJcbiAgICAgIHsgY29sOiAnbm90ZV9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcclxuICAgICAgeyBjb2w6ICd2ZW5kb3JfZXh0JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgYWwgcXVlIGFwbGljYSBsYSBub3RhJyB9LFxyXG4gICAgICB7IGNvbDogJ2NsaWVudF9rZXknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2NsYXZlIGNvbXB1ZXN0YSBjbGllbnRlJyB9LFxyXG4gICAgICB7IGNvbDogJ2NsaWVudF9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAncHJvdmluY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdsb2NhbGl0eScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3RleHQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3RleHRvIGxpYnJlIGRlIGxhIG5vdGEnIH0sXHJcbiAgICAgIHsgY29sOiAnYXV0aG9yX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2F1dGhvcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ2F1dGhvcl9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnYXV0aG9yX3JvbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2FkbWluIHwgZ2VyZW50ZSB8IGludGVybm8nIH0sXHJcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcclxuICAgIF0sXHJcbiAgfSxcclxuICAvLyB2NzMyICgyMDI2LTA4LTI5KTogMyBzbmFwc2hvdHMgQlEtPkZpcmVzdG9yZSBhaG9yYSBpbmNsdWlkb3MgZW4gZWwgZGF0YXNldCBNTC5cclxuICAvLyBBbnRlcyBlc3RhYmFuIGVuIGV4Y2x1ZGVkQ29sbGVjdGlvbnMgZGVsIG1hbmlmZXN0LiBSYWNpb25hbDogc29uIGZ1ZW50ZSBkZVxyXG4gIC8vIHZlcmRhZCBkZSBmYWN0dXJhY2lvbiBSRUFMIFNBUCAobmV0byBOQ3MpLCBkZW1hbmQtc3VwcmVzc2lvbiAoYmFja29yZGVycylcclxuICAvLyB5IGFncmVnYWRvcyBkaWFyaW9zIGxpc3Rvcy1wYXJhLWJlbmNobWFyay5cclxuICBzYXBfc25hcHNob3Q6IHtcclxuICAgIG5hbWU6ICdzYXBfc25hcHNob3QuY3N2JyxcclxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXHJcbiAgICBjb2xsZWN0aW9uOiAnc2FwX3NuYXBzaG90JyxcclxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXHJcbiAgICBjb2x1bW5zOiBbXHJcbiAgICAgIHsgY29sOiAnZG9jX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEIChWRU5ET1JfTk9STV9ZWVlZX01NKScgfSxcclxuICAgICAge1xyXG4gICAgICAgIGNvbDogJ3ZlbmRvcl9rZXknLFxyXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxyXG4gICAgICAgIGRlc2M6ICdub21icmUgZGVsIHZlbmRlZG9yIHRhbCBjdWFsIHZpZW5lIGRlIFNBUCAoc2luIG5vcm1hbGl6YXIpJyxcclxuICAgICAgfSxcclxuICAgICAgeyBjb2w6ICdhbmlvJywgdHlwZTogJ2ludGVnZXInLCBkZXNjOiAnYW5pbyBjYWxlbmRhcmlvJyB9LFxyXG4gICAgICB7IGNvbDogJ21lcycsIHR5cGU6ICdpbnRlZ2VyJywgZGVzYzogJzEtMTInIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBjb2w6ICdmYWN0dXJhZG9fYXJzX25ldG8nLFxyXG4gICAgICAgIHR5cGU6ICdudW1iZXInLFxyXG4gICAgICAgIGRlc2M6ICdmYWN0dXJhcyAtIE5DcyBBUlMgKGNvbiBJVkEgY2FyZ2FkbyBlbiBlbCBpbXBvcnRlKScsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAnZmFjdHVyYWRvX2Fyc19icnV0bycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnZmFjdHVyYXMgKyBOQ3Mgc3VtYWRhcyBBUlMgYnJ1dG8nIH0sXHJcbiAgICAgIHsgY29sOiAnbmNzX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnbW9udG8gZGUgbm90YXMgZGUgY3JlZGl0byBBUlMnIH0sXHJcbiAgICAgIHsgY29sOiAnZmFjdHVyYXNfY291bnQnLCB0eXBlOiAnaW50ZWdlcicsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnbmNzX2NvdW50JywgdHlwZTogJ2ludGVnZXInLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3VuaWRhZGVzX25ldG8nLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3N1bShxdHkpIGZhY3R1cmFzIC0gc3VtKHF0eSkgTkNzJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAnaW1wb3J0ZV9saW5lYXNfYXJzX25ldG8nLFxyXG4gICAgICAgIHR5cGU6ICdudW1iZXInLFxyXG4gICAgICAgIGRlc2M6ICdzdW0gaW1wb3J0ZXMgZGUgbGluZWEgKHNpbiBJVkEpOyB1c2FyIGVzdGUgY2FtcG8gcGFyYSBtb2RlbG9zIGRlIG5lZ29jaW8gLSBmYWN0dXJhZG9fYXJzX25ldG8gaW5jbHV5ZSBJVkEgeSBzb2JyZWVzdGltYScsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBkZWwgc3luYyBCUS0+RmlyZXN0b3JlJyB9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIGZhY3R1cmFjaW9uX3NuYXBzaG90OiB7XHJcbiAgICBuYW1lOiAnZmFjdHVyYWNpb25fc25hcHNob3QuY3N2JyxcclxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXHJcbiAgICBjb2xsZWN0aW9uOiAnZmFjdHVyYWNpb25fc25hcHNob3QnLFxyXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcclxuICAgIGNvbHVtbnM6IFtcclxuICAgICAgeyBjb2w6ICdkb2NfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgKFZFTkRPUl9OT1JNIG8gVE9UQUxfTkFDSU9OQUwpJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAndmVuZG9yX2tleScsXHJcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgZGVzYzogJ25vbWJyZSBjYW5vbmljbyBkZWwgdmVuZGVkb3IgLSBUT1RBTF9OQUNJT05BTCBwYXJhIGVsIHJvbGx1cCBuYWNpb25hbCcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAnaG95X2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnZmFjdHVyYWNpb24gZGVsIGRpYSBhY3R1YWwgQVJTJyB9LFxyXG4gICAgICB7IGNvbDogJ21lc19hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2ZhY3R1cmFjaW9uIE1URCBkZWwgbWVzIGFjdHVhbCBBUlMnIH0sXHJcbiAgICAgIHsgY29sOiAnYW5vX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnZmFjdHVyYWNpb24gWVREIGRlbCBhbmlvIGFjdHVhbCBBUlMnIH0sXHJcbiAgICAgIHsgY29sOiAndXBkYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBkZWwgdWx0aW1vIHN5bmMnIH0sXHJcbiAgICBdLFxyXG4gIH0sXHJcbiAgYmFja29yZGVyX3NuYXBzaG90OiB7XHJcbiAgICBuYW1lOiAnYmFja29yZGVyX3NuYXBzaG90LmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ2JhY2tvcmRlcl9zbmFwc2hvdCcsXHJcbiAgICByb3dNb2RlOiAnb25lX3Blcl9saW5lJyxcclxuICAgIGNvbHVtbnM6IFtcclxuICAgICAge1xyXG4gICAgICAgIGNvbDogJ2RvY19pZCcsXHJcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXHJcbiAgICAgICAgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgKFZFTkRPUl9OT1JNKTsgdW4gZG9jID0gdW4gdmVuZGVkb3IsIHJlcGxpY2FkbyBlbiBjYWRhIGxpbmVhJyxcclxuICAgICAgfSxcclxuICAgICAgeyBjb2w6ICd2ZW5kb3Jfa2V5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdub21icmUgZGVsIHZlbmRlZG9yIHNpbiBub3JtYWxpemFyJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAnbGluZXNfY291bnQnLFxyXG4gICAgICAgIHR5cGU6ICdpbnRlZ2VyJyxcclxuICAgICAgICBkZXNjOiAnY2FudGlkYWQgdG90YWwgZGUgbGluZWFzIGVuIGVsIHNuYXBzaG90IGRlbCB2ZW5kZWRvciAocmVwbGljYWRvIGVuIGNhZGEgcm93IHBhcmEgam9pbnMpJyxcclxuICAgICAgfSxcclxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxyXG4gICAgICB7IGNvbDogJ3NrdScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnU0tVIGRlbCBwcm9kdWN0byBlbiBiYWNrb3JkZXIgKHNvbG8gUEVTQ0EpJyB9LFxyXG4gICAgICB7IGNvbDogJ3Byb2R1Y3RvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdub21icmUgZGVsIHByb2R1Y3RvJyB9LFxyXG4gICAgICB7IGNvbDogJ2ZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdzdWJmYW1pbGlhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAncGVuZGllbnRlJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICd1bmlkYWRlcyBwZW5kaWVudGVzIGRlIGRlc3BhY2hvIChiYWNrb3JkZXIpJyB9LFxyXG4gICAgICB7IGNvbDogJ3BlZGlkbycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAndW5pZGFkZXMgcGVkaWRhcyBvcmlnaW5hbG1lbnRlIGVuIGxhIFNRJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY29sOiAnc3RvY2tfYWN0dWFsJyxcclxuICAgICAgICB0eXBlOiAnaW50ZWdlcicsXHJcbiAgICAgICAgZGVzYzogJ3N0b2NrIGRpc3BvbmlibGUgZGVsIFNLVSBhbCBtb21lbnRvIGRlbCBzbmFwc2hvdCcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgY29sOiAncHJlY2lvX3VuaXRhcmlvJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdwcmVjaW8gdW5pdGFyaW8gQVJTJyB9LFxyXG4gICAgICB7IGNvbDogJ2NsaWVudGVfY29kZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2FyZENvZGUgU0FQIGRlbCBjbGllbnRlJyB9LFxyXG4gICAgICB7IGNvbDogJ2NsaWVudGVfbm9tYnJlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXHJcbiAgICAgIHsgY29sOiAnY2xpZW50ZV9jaXVkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcclxuICAgICAgeyBjb2w6ICdzcV9kb2NfbnVtJywgdHlwZTogJ2ludGVnZXInLCBkZXNjOiAnbnVtZXJvIGRlIFNhbGVzIFF1b3RhdGlvbiBTQVAnIH0sXHJcbiAgICAgIHsgY29sOiAnc3FfZG9jX2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdmZWNoYSBkZSBsYSBTUScgfSxcclxuICAgICAgeyBjb2w6ICdlc3RhZG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VzdGFkbyBkZWwgYmFja29yZGVyIHNlZ3VuIFNBUCcgfSxcclxuICAgIF0sXHJcbiAgfSxcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBEQVRBU0VUX1VTRV9DQVNFX01BVFJJWCBcdTIwMTQgY2Fzb3MgZGUgdXNvIE1MIGNvbiBjYW1wb3MgcmVxdWVyaWRvc1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8qKiBAdHlwZWRlZiB7e3ByaW9yaXR5OiBudW1iZXJ8c3RyaW5nLCBkZXNjcmlwdGlvbjogc3RyaW5nLCByZXF1aXJlZEZpZWxkczogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+LCBqb2luTm90ZXM/OiBzdHJpbmd9fSBVc2VDYXNlICovXHJcblxyXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFVzZUNhc2U+fSAqL1xyXG5leHBvcnQgY29uc3QgREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVggPSB7XHJcbiAgQV9jb252ZXJzaW9uX3Zpc2l0YV9wZWRpZG86IHtcclxuICAgIHByaW9yaXR5OiAxLFxyXG4gICAgZGVzY3JpcHRpb246ICdQcmVkZWNpciBxdWUgdmlzaXRhcyB0ZXJtaW5hbiBlbiBwZWRpZG8gcGFyYSBwcmlvcml6YXIgbGEgcnV0YSBkZWwgdmVuZGVkb3IuJyxcclxuICAgIHJlcXVpcmVkRmllbGRzOiB7XHJcbiAgICAgICd2aXNpdGFzLmNzdic6IFsnZmVjaGEnLCAnb3duZXJfdWlkJywgJ3Byb3ZpbmNpYScsICdsb2NhbGlkYWQnLCAndGllbmRhJ10sXHJcbiAgICAgICdwZWRpZG9zLmNzdic6IFsnY29uZmlybWVkX2F0JywgJ293bmVyX3VpZCcsICdwcm92aW5jZScsICdsb2NfbmFtZScsICdjbGllbnRfbmFtZSddLFxyXG4gICAgfSxcclxuICAgIGpvaW5Ob3RlczpcclxuICAgICAgJ0pPSU4gcG9yIChwcm92aW5jaWEsIGxvY2FsaWRhZCwgdGllbmRhfmNsaWVudF9uYW1lKSBlbiB2ZW50YW5hIHRlbXBvcmFsIGZlY2hhX3Zpc2l0YS4uY29uZmlybWVkX2F0LiBObyBoYXkgY2FyZENvZGVTYXAgY29tdW4gZW50cmUgdmlzaXRzIHkgcGVkaWRvcy4nLFxyXG4gIH0sXHJcbiAgQl9jaHVybl9jbGllbnRlczoge1xyXG4gICAgcHJpb3JpdHk6IDIsXHJcbiAgICBkZXNjcmlwdGlvbjogJ0RldGVjdGFyIGNsaWVudGVzIHF1ZSBzZSBlbmZyaWFuIGFudGVzIGRlIHBlcmRlcmxvcy4nLFxyXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcclxuICAgICAgJ2NsaWVudGVzLmNzdic6IFsnY3JlYXRlZF9hdCcsICdhc3NpZ25lZF92ZW5kb3InLCAncHJvdmluY2lhJywgJ3N0YXR1cycsICdjYXJkX2NvZGVfc2FwJ10sXHJcbiAgICAgICdwZWRpZG9zLmNzdic6IFsnY29uZmlybWVkX2F0JywgJ2NsaWVudF9uYW1lJywgJ3Byb3ZpbmNlJywgJ2xvY19uYW1lJ10sXHJcbiAgICB9LFxyXG4gICAgam9pbk5vdGVzOlxyXG4gICAgICAnSk9JTiB2aWEgY2xpZW50X2FwcGxpY2F0aW9ucy5jYXJkX2NvZGVfc2FwIHZzIHBlZGlkb3Mua2V5IChwYXJzZWFkbykuIEZyYWdpbCAtIGNvbnNpZGVyYXIgZnV6enkgbWF0Y2ggcG9yIG5vbWJyZS4nLFxyXG4gIH0sXHJcbiAgQ19mb3JlY2FzdF9za3U6IHtcclxuICAgIHByaW9yaXR5OiAzLFxyXG4gICAgZGVzY3JpcHRpb246ICdBbnRpY2lwYXIgcXVlIHByb2R1Y3RvcyBzZSB2YW4gYSBwZWRpciBwb3IgcGVyaW9kby4nLFxyXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcclxuICAgICAgJ3BlZGlkb3MuY3N2JzogWydsaW5lX2NvZGUnLCAnbGluZV9xdHknLCAnbGluZV9wcmVjaW8nLCAnY29uZmlybWVkX2F0JywgJ3Byb3ZpbmNlJ10sXHJcbiAgICAgICdwcm9kdWN0b3MuY3N2JzogWydza3UnXSxcclxuICAgIH0sXHJcbiAgICBqb2luTm90ZXM6XHJcbiAgICAgICdEZXNjdWVudG8gYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIgKGRpc2NvdW50X3BjdCkgLSBwcm9ycmF0ZWFyIGVuIGVsIHBpcGVsaW5lIGRvd25zdHJlYW0gcHJvcG9yY2lvbmFsIGEgc3VidG90YWxfYnJ1dG8gZGUgY2FkYSBsaW5lYS4gRW5yaXF1ZWNlciBjb24gY2F0YWxvZ28gQlEgKHNhcF9pdGVtc19yYXcpIHNpIGhhY2UgZmFsdGEgY2F0L2ZhbS9zdWIgYWRpY2lvbmFsLicsXHJcbiAgfSxcclxuICBEX2Fub21hbGlhc19yZW5kaWNpb25lczoge1xyXG4gICAgcHJpb3JpdHk6ICdleHBsb3JhdG9yaW8nLFxyXG4gICAgZGVzY3JpcHRpb246ICdEZXRlY3RhciBvdXRsaWVycyBkZSBnYXN0b3MuJyxcclxuICAgIHJlcXVpcmVkRmllbGRzOiB7XHJcbiAgICAgICdyZW5kaWNpb25lcy5jc3YnOiBbJ2ltcG9ydGVfYXJzJywgJ3RpcG9fZ2FzdG8nLCAnb3duZXJfdWlkJywgJ2ZlY2hhX2dhc3RvJywgJ3N0YXR1cyddLFxyXG4gICAgfSxcclxuICB9LFxyXG4gIEVfZXN0YWNpb25hbGlkYWRfem9uYV9jYXRlZ29yaWE6IHtcclxuICAgIHByaW9yaXR5OiAnZXhwbG9yYXRvcmlvJyxcclxuICAgIGRlc2NyaXB0aW9uOiAnSW5zdW1vIHBhcmEgYXJtYWRvIGRlIGNhbXBhbmlhcyBlc3RhY2lvbmFsZXMuJyxcclxuICAgIHJlcXVpcmVkRmllbGRzOiB7XHJcbiAgICAgICdwZWRpZG9zLmNzdic6IFsnY29uZmlybWVkX2F0JywgJ3Byb3ZpbmNlJywgJ2xpbmVfY29kZScsICdsaW5lX2ZhbScsICdsaW5lX3F0eSddLFxyXG4gICAgICAnY2xpZW50ZXMuY3N2JzogWydwcm92aW5jaWEnLCAnYXNzaWduZWRfdmVuZG9yJ10sXHJcbiAgICAgICdjYW1wYW5pYXMuY3N2JzogWydzdGFydF9kYXRlJywgJ2VuZF9kYXRlJywgJ3NrdXNfanNvbicsICdzY29wZSddLFxyXG4gICAgICAndGFyZ2V0cy5jc3YnOiBbJ3llYXInLCAnbW9udGgnLCAndGFyZ2V0X2FycyddLFxyXG4gICAgfSxcclxuICB9LFxyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFJvdyBidWlsZGVycyBcdTIwMTQgZnVuY2lvbmVzIHB1cmFzIChkb2MgLT4gYXJyYXkgZGUgcm93cylcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG4vKipcclxuICogRXh0cmFlIHZhbG9yIEZpcmVzdG9yZSBkZSBkb2MgY29uIHBhdGggYW5pZGFkby4gRGV2dWVsdmUgcmF3IChubyBDU1YpLlxyXG4gKiBFajogZ2V0RmllbGQoZG9jLCAndHJhbnNmZXJpZG9TQVAuZG9jTnVtJylcclxuICogQHBhcmFtIHtvYmplY3R9IGRvY1xyXG4gKiBAcGFyYW0ge3N0cmluZ30gcGF0aFxyXG4gKi9cclxuZnVuY3Rpb24gZihkb2MsIHBhdGgpIHtcclxuICByZXR1cm4gZ2V0UGF0aChkb2MsIHBhdGgpO1xyXG59XHJcblxyXG4vKipcclxuICogUm93IGJ1aWxkZXIgZ2VuZXJpY286IG1hcGVhIHVuIGRvYyBhIGFycmF5IGRlIHZhbG9yZXMgc2VndW4gdW4gYXJyYXkgZGUgcGF0aHMuXHJcbiAqIEBwYXJhbSB7b2JqZWN0fSBkb2NcclxuICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aHNcclxuICogQHJldHVybnMge3Vua25vd25bXX1cclxuICovXHJcbmZ1bmN0aW9uIF9idWlsZFJvdyhkb2MsIHBhdGhzKSB7XHJcbiAgcmV0dXJuIHBhdGhzLm1hcCgocCkgPT4gKHAgPT09ICdfX2lkX18nID8gLyoqIEB0eXBlIHthbnl9ICovIChkb2MpLl9pZCA6IGYoZG9jLCBwKSkpO1xyXG59XHJcblxyXG4vKipcclxuICogUGVkaWRvczogZmxhdHRlbiAxIGZpbGEgcG9yIGxpbmVhLiBIZWFkZXIgcGVkaWRvIHJlcGxpY2FkbyBlbiBjYWRhLlxyXG4gKiBkb2MuX2lkIGVzIGVsIElEOyBzZSBlc3BlcmEgcXVlIGVsIGNhbGxlciBsbyBhZ3JlZ3VlIGFudGVzIGRlIHBhc2FyLlxyXG4gKiBAcGFyYW0ge2FueX0gZG9jXHJcbiAqIEByZXR1cm5zIHt1bmtub3duW11bXX1cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZFBlZGlkb1Jvd3MoZG9jKSB7XHJcbiAgY29uc3QgaGVhZGVyID0gW1xyXG4gICAgZG9jLl9pZCxcclxuICAgIGRvYy5vd25lclVpZCxcclxuICAgIGRvYy5vd25lckVtYWlsLFxyXG4gICAgZG9jLmNyZWF0ZWRCeVVpZCxcclxuICAgIGRvYy5vbkJlaGFsZk9mLFxyXG4gICAgZG9jLmtleSxcclxuICAgIGRvYy5zdGFnZSxcclxuICAgIGRvYy50aXBvLFxyXG4gICAgZG9jLnByb3ZpbmNlLFxyXG4gICAgZG9jLmxvY05hbWUsXHJcbiAgICBkb2MuY2xpZW50TmFtZSxcclxuICAgIGRvYy5tb250aCxcclxuICAgIGRvYy5tb250aElkeCxcclxuICAgIGRvYy55ZWFyLFxyXG4gICAgZG9jLmNvbmZpcm1lZEF0LFxyXG4gICAgZG9jLmNvbmRpY2lvblBhZ28sXHJcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50aXBvIDogbnVsbCxcclxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLnRyYW5zcE5vbWJyZSA6IG51bGwsXHJcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50cmFuc3BEaXJlY2Npb24gOiBudWxsLFxyXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2EuY2xpZW50ZURpcmVjY2lvbiA6IG51bGwsXHJcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS5zdWN1cnNhbERpcmVjY2lvbiA6IG51bGwsXHJcbiAgICBkb2MuZGlzY291bnRQY3QsXHJcbiAgICBkb2Muc3VidG90YWxBcnMsXHJcbiAgICBkb2MubmV0QW1vdW50QXJzLFxyXG4gICAgZG9jLnRyYW5zZmVyaWRvU0FQID8gZG9jLnRyYW5zZmVyaWRvU0FQLnZpYSA6IG51bGwsXHJcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuZG9jTnVtIDogbnVsbCxcclxuICAgIGRvYy50cmFuc2Zlcmlkb1NBUCA/IGRvYy50cmFuc2Zlcmlkb1NBUC5kb2NFbnRyeSA6IG51bGwsXHJcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuYXQgOiBudWxsLFxyXG4gICAgZG9jLmNyZWF0ZWRBdCxcclxuICBdO1xyXG4gIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShkb2MubGluZXMpID8gZG9jLmxpbmVzIDogW107XHJcbiAgaWYgKCFsaW5lcy5sZW5ndGgpIHtcclxuICAgIC8vIFBlZGlkbyBzaW4gbGluZWFzIC0+IDEgZmlsYSBjb24gbGluZV8qIHZhY2lvc1xyXG4gICAgcmV0dXJuIFtoZWFkZXIuY29uY2F0KFtudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsXSldO1xyXG4gIH1cclxuICByZXR1cm4gbGluZXMubWFwKCgvKiogQHR5cGUge2FueX0gKi8gbCwgLyoqIEB0eXBlIHtudW1iZXJ9ICovIGlkeCkgPT5cclxuICAgIGhlYWRlci5jb25jYXQoW1xyXG4gICAgICBpZHgsXHJcbiAgICAgIGwgPyBsLmNvZGUgOiBudWxsLFxyXG4gICAgICBsID8gbC5kZXNjIDogbnVsbCxcclxuICAgICAgbCA/IGwucXR5IDogbnVsbCxcclxuICAgICAgbCA/IGwucHJlY2lvIDogbnVsbCxcclxuICAgICAgbCA/IGwuY2F0IDogbnVsbCxcclxuICAgICAgbCA/IGwuZmFtIDogbnVsbCxcclxuICAgICAgbCA/IGwuc3ViIDogbnVsbCxcclxuICAgIF0pXHJcbiAgKTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWaXNpdGFSb3dzKGRvYykge1xyXG4gIHJldHVybiBbXHJcbiAgICBbXHJcbiAgICAgIGRvYy5faWQsXHJcbiAgICAgIGRvYy5vd25lclVpZCxcclxuICAgICAgZG9jLm93bmVyRW1haWwsXHJcbiAgICAgIGRvYy5mZWNoYSxcclxuICAgICAgZG9jLm1lcyxcclxuICAgICAgZG9jLmFuaW8sXHJcbiAgICAgIGRvYy52ZW5kb3IsXHJcbiAgICAgIGRvYy5wcm92aW5jaWEsXHJcbiAgICAgIGRvYy5sb2NhbGlkYWQsXHJcbiAgICAgIGRvYy50aWVuZGEsXHJcbiAgICAgIGRvYy50aXBvLFxyXG4gICAgICBkb2MubG9jYWwsXHJcbiAgICAgIGRvYy50YW1hbm8sXHJcbiAgICAgIGRvYy5maWRlbGlkYWQsXHJcbiAgICAgIGRvYy5yZWxldmFuY2lhLFxyXG4gICAgICBkb2MucG9wLFxyXG4gICAgICBkb2MubmVjZXNpZGFkUHVudHVhbCxcclxuICAgICAgZG9jLnRpcG9WZW50YSxcclxuICAgICAgZG9jLnBvbmRlcmFjaW9uTW9zdHJhZG8sXHJcbiAgICAgIGRvYy5wb25kZXJhY2lvbkVjb21tZXJjZSxcclxuICAgICAgZG9jLmNvbXBldGVuY2lhLFxyXG4gICAgICBkb2Mub3BvcnR1bmlkYWQsXHJcbiAgICAgIGRvYy5tYXNWZW5kaWRvLFxyXG4gICAgICBkb2MubWFzUHJlZ3VudGFuLFxyXG4gICAgICBkb2MuYXl1ZGFUaWVuZGEsXHJcbiAgICAgIGRvYy5ncHNTdGF0dXMsXHJcbiAgICAgIGRvYy5ncHNEaXN0YW5jZU0sXHJcbiAgICAgIGRvYy5pbnRlcmFjdGlvblR5cGUsXHJcbiAgICAgIGRvYy5mb3JtYUNvbnRhY3RvLFxyXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG8sXHJcbiAgICAgIGRvYy5jb250YWN0b1Jlc3VsdGFkb0F0LFxyXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG9CeSxcclxuICAgICAgZG9jLmNyZWF0ZWRBdCxcclxuICAgIF0sXHJcbiAgXTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDbGllbnRlUm93cyhkb2MpIHtcclxuICByZXR1cm4gW1xyXG4gICAgW1xyXG4gICAgICBkb2MuX2lkLFxyXG4gICAgICBkb2Mub3duZXJVaWQsXHJcbiAgICAgIGRvYy5vd25lckVtYWlsLFxyXG4gICAgICBkb2Mub3duZXJOYW1lLFxyXG4gICAgICBkb2MuY29tZXJjaW8sXHJcbiAgICAgIGRvYy5mYW50YXNpYSxcclxuICAgICAgZG9jLmN1aXQsXHJcbiAgICAgIGRvYy5jb25kaWNpb25GaXNjYWwsXHJcbiAgICAgIGRvYy5jYWxsZSxcclxuICAgICAgZG9jLm51bWVybyxcclxuICAgICAgZG9jLmxvY2FsaWRhZCxcclxuICAgICAgZG9jLnByb3ZpbmNpYSxcclxuICAgICAgZG9jLmxvY2FsaWRhZEZpbmFsLFxyXG4gICAgICBkb2MuY2FyZENvZGVTYXAsXHJcbiAgICAgIGRvYy5hc3NpZ25lZFZlbmRvcixcclxuICAgICAgZG9jLnN0YXR1cyxcclxuICAgICAgZG9jLnNvdXJjZSxcclxuICAgICAgZG9jLm1hbnVhbFNhcFBlbmRpbmcsXHJcbiAgICAgIGRvYy5wcmVjYXVjaW9uLFxyXG4gICAgICBkb2MuY2F0ZWdvcmlhQ2xpZW50ZSxcclxuICAgICAgZG9jLmNsaVRpcG8sXHJcbiAgICAgIGRvYy5sYXQsXHJcbiAgICAgIGRvYy5sbmcsXHJcbiAgICAgIGRvYy5sYXQgIT0gbnVsbCAmJiBkb2MubG5nICE9IG51bGwsXHJcbiAgICAgICEhKGRvYy5jYWxsZSB8fCBkb2MuYWRkcmVzcyksXHJcbiAgICAgIGRvYy5zdWJtaXR0ZWRCeVB1YmxpY0Zvcm0sXHJcbiAgICAgIGRvYy5hcHByb3ZlZEF0LFxyXG4gICAgICBkb2MuY3JlYXRlZEF0LFxyXG4gICAgICBkb2MudXBkYXRlZEF0LFxyXG4gICAgXSxcclxuICBdO1xyXG59XHJcblxyXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZENsaWVudE1hc3RlclJvd3MoZG9jKSB7XHJcbiAgcmV0dXJuIFtcclxuICAgIFtcclxuICAgICAgZG9jLl9pZCxcclxuICAgICAgZG9jLmNsaWVudE5hbWUsXHJcbiAgICAgIGRvYy5wcm92aW5jaWEsXHJcbiAgICAgIGRvYy5sb2NhbGlkYWQsXHJcbiAgICAgIGRvYy52ZW5kb3IsXHJcbiAgICAgIGRvYy5hZGRyZXNzLFxyXG4gICAgICBkb2Muc2FwQ2FyZENvZGUsXHJcbiAgICAgIGRvYy5zYXBBZGRyZXNzLFxyXG4gICAgICBkb2Muc2FwQ2l0eSxcclxuICAgICAgZG9jLnNhcFN0YXRlLFxyXG4gICAgICBkb2Muc2FwSW1wb3J0ZWRBdCxcclxuICAgICAgZG9jLnNhcEltcG9ydGVkQnksXHJcbiAgICAgIGRvYy5jbGllbnROYW1lT3JpZ2luYWwsXHJcbiAgICAgIGRvYy5sb2NhbGlkYWRPcmlnaW5hbCxcclxuICAgICAgZG9jLm1hdGNoVHlwZSxcclxuICAgICAgZG9jLm1hdGNoU2ltaWxhcml0eSxcclxuICAgICAgZG9jLnVwZGF0ZWRBdCxcclxuICAgICAgZG9jLnVwZGF0ZWRCeSxcclxuICAgIF0sXHJcbiAgXTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSZW5kaWNpb25Sb3dzKGRvYykge1xyXG4gIHJldHVybiBbXHJcbiAgICBbXHJcbiAgICAgIGRvYy5faWQsXHJcbiAgICAgIGRvYy5vd25lclVpZCxcclxuICAgICAgZG9jLm93bmVyRW1haWwsXHJcbiAgICAgIGRvYy52ZW5kb3IsXHJcbiAgICAgIGRvYy50aXBvLFxyXG4gICAgICBkb2MudGlwb0dhc3RvLFxyXG4gICAgICBkb2MuaW1wb3J0ZUFycyAhPSBudWxsID8gZG9jLmltcG9ydGVBcnMgOiBkb2MuaW1wb3J0ZSxcclxuICAgICAgZG9jLmZlY2hhR2FzdG8sXHJcbiAgICAgIGRvYy5jb25jZXB0byxcclxuICAgICAgLy8gZm90b1RpY2tldFVybCAodjMwOCspIHByaW9yaWRhZDsgTlVOQ0EgZXhwb3J0YXIgYmFzZTY0IGZvdG9UaWNrZXQgbGVnYWN5XHJcbiAgICAgIGRvYy5mb3RvVGlja2V0VXJsIHx8IG51bGwsXHJcbiAgICAgIGRvYy5zdGF0dXMsXHJcbiAgICAgIGRvYy5hcHByb3ZlZEJ5LFxyXG4gICAgICBkb2MuYXBwcm92ZWRBdCxcclxuICAgICAgZG9jLnJlamVjdGVkQnlFbWFpbCxcclxuICAgICAgZG9jLnJlamVjdGVkUmVhc29uLFxyXG4gICAgICBkb2MuYXBwcm92ZXJVaWQsXHJcbiAgICAgIGRvYy5jcmVhdGVkQXQsXHJcbiAgICBdLFxyXG4gIF07XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQ2FtcGFuaWFSb3dzKGRvYykge1xyXG4gIHJldHVybiBbXHJcbiAgICBbXHJcbiAgICAgIGRvYy5faWQsXHJcbiAgICAgIGRvYy5uYW1lLFxyXG4gICAgICBkb2MuZmFtaWxpYSxcclxuICAgICAgZG9jLnN1YmZhbWlsaWEsXHJcbiAgICAgIGRvYy5maWx0ZXJUeXBlLFxyXG4gICAgICBkb2MuZmlsdGVyVmFsdWVzLFxyXG4gICAgICBkb2Muc2t1cyxcclxuICAgICAgQXJyYXkuaXNBcnJheShkb2Muc2t1cykgPyBkb2Muc2t1cy5sZW5ndGggOiAwLFxyXG4gICAgICBkb2MudGFyZ2V0VHlwZSxcclxuICAgICAgZG9jLnRhcmdldEFtb3VudCxcclxuICAgICAgZG9jLnN0YXJ0RGF0ZSxcclxuICAgICAgZG9jLmVuZERhdGUsXHJcbiAgICAgIGRvYy5zY29wZSxcclxuICAgICAgZG9jLnNjb3BlVmFsdWVzLFxyXG4gICAgICBkb2MuY3JlYXRlZEJ5LFxyXG4gICAgICBkb2MuY3JlYXRlZEJ5RW1haWwsXHJcbiAgICAgIGRvYy5jcmVhdGVkQXQsXHJcbiAgICAgIGRvYy5hcmNoaXZlZE1hbnVhbGx5LFxyXG4gICAgICBkb2MuYXJjaGl2ZWRBdCxcclxuICAgICAgZG9jLmFyY2hpdmVkQnksXHJcbiAgICBdLFxyXG4gIF07XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVGFyZ2V0Um93cyhkb2MpIHtcclxuICByZXR1cm4gW1xyXG4gICAgW1xyXG4gICAgICBkb2MuX2lkLFxyXG4gICAgICBkb2Muc2VsbGVySWQsXHJcbiAgICAgIGRvYy55ZWFyLFxyXG4gICAgICBkb2MubW9udGgsXHJcbiAgICAgIGRvYy50YXJnZXRBcnMsXHJcbiAgICAgIGRvYy50YXJnZXRCeUZhbWlseSA/IGRvYy50YXJnZXRCeUZhbWlseS5SRUVMIDogbnVsbCxcclxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LkNBTkFTIDogbnVsbCxcclxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LkxJTkVBUyA6IG51bGwsXHJcbiAgICAgIGRvYy51cGRhdGVkQXQsXHJcbiAgICAgIGRvYy51cGRhdGVkQnksXHJcbiAgICAgIGRvYy51cGRhdGVkQnlFbWFpbCxcclxuICAgIF0sXHJcbiAgXTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWZW5kb3JPdmVycmlkZVJvd3MoZG9jKSB7XHJcbiAgcmV0dXJuIFtcclxuICAgIFtcclxuICAgICAgZG9jLl9pZCxcclxuICAgICAgZG9jLnNjb3BlLFxyXG4gICAgICBkb2MucHJvdmluY2UsXHJcbiAgICAgIGRvYy5sb2NhbGl0eU5hbWUsXHJcbiAgICAgIGRvYy5jbGllbnROYW1lLFxyXG4gICAgICBkb2Mub3JpZ2luYWxWZW5kb3IsXHJcbiAgICAgIGRvYy5uZXdWZW5kb3IsXHJcbiAgICAgIGRvYy5uZXdUeXBlLFxyXG4gICAgICBkb2MudXBkYXRlZEF0LFxyXG4gICAgICBkb2MudXBkYXRlZEJ5VWlkLFxyXG4gICAgICBkb2MudXBkYXRlZEJ5RW1haWwsXHJcbiAgICAgIGRvYy51cGRhdGVkQnlEaXNwbGF5TmFtZSxcclxuICAgIF0sXHJcbiAgXTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDdXN0b21Sb3V0ZVJvd3MoZG9jKSB7XHJcbiAgY29uc3QgaGVhZGVyID0gW1xyXG4gICAgZG9jLl9pZCxcclxuICAgIGRvYy5vd25lclVpZCxcclxuICAgIGRvYy5vd25lckVtYWlsLFxyXG4gICAgZG9jLm5hbWUsXHJcbiAgICBkb2MucGxhbm5lZERhdGUsXHJcbiAgICBkb2Mubm90ZXMsXHJcbiAgICBkb2MuY3JlYXRlZEF0LFxyXG4gICAgZG9jLnVwZGF0ZWRBdCxcclxuICBdO1xyXG4gIGNvbnN0IHN0b3BzID0gQXJyYXkuaXNBcnJheShkb2Muc3RvcHMpID8gZG9jLnN0b3BzIDogW107XHJcbiAgaWYgKCFzdG9wcy5sZW5ndGgpIHtcclxuICAgIHJldHVybiBbaGVhZGVyLmNvbmNhdChbbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbF0pXTtcclxuICB9XHJcbiAgcmV0dXJuIHN0b3BzLm1hcCgoLyoqIEB0eXBlIHthbnl9ICovIHMpID0+XHJcbiAgICBoZWFkZXIuY29uY2F0KFtcclxuICAgICAgcyA/IHMub3JkZXIgOiBudWxsLFxyXG4gICAgICBzID8gcy5rZXkgOiBudWxsLFxyXG4gICAgICBzID8gcy50aXBvIDogbnVsbCxcclxuICAgICAgcyA/IHMucHJvdmluY2lhIDogbnVsbCxcclxuICAgICAgcyA/IHMubG9jYWxpZGFkIDogbnVsbCxcclxuICAgICAgcyA/IHMuY2xpZW50TmFtZSA6IG51bGwsXHJcbiAgICAgIHMgPyBzLmlzUHJvdmlzb3JpbyA6IG51bGwsXHJcbiAgICAgIHMgPyBzLnNhcEFsdGFJZCA6IG51bGwsXHJcbiAgICBdKVxyXG4gICk7XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2VndWltaWVudG9Ob3RlUm93cyhkb2MpIHtcclxuICByZXR1cm4gW1xyXG4gICAgW1xyXG4gICAgICBkb2MuX2lkLFxyXG4gICAgICBkb2MudmVuZG9yRXh0LFxyXG4gICAgICBkb2MuY2xpZW50S2V5LFxyXG4gICAgICBkb2MuY2xpZW50TmFtZSxcclxuICAgICAgZG9jLnByb3ZpbmNlLFxyXG4gICAgICBkb2MubG9jYWxpdHksXHJcbiAgICAgIGRvYy50ZXh0LFxyXG4gICAgICBkb2MuYXV0aG9yVWlkLFxyXG4gICAgICBkb2MuYXV0aG9yRW1haWwsXHJcbiAgICAgIGRvYy5hdXRob3JOYW1lLFxyXG4gICAgICBkb2MuYXV0aG9yUm9sZSxcclxuICAgICAgZG9jLmNyZWF0ZWRBdCxcclxuICAgIF0sXHJcbiAgXTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFByb2R1Y3RvcyBkZXNkZSBzdG9jay5qc29uIChmb3JtYXRvIFNoaW1hbm86IHtzdG9jazoge1NLVTogYm9vbCwgLi4ufSxcclxuICogcXVhbnRpdGllczogSlNPTiBzdHJpbmcsIHdhcmVob3VzZUJyZWFrZG93bjogSlNPTiBzdHJpbmcsIHVwZGF0ZWRBdDogLi4ufSkuXHJcbiAqIEBwYXJhbSB7b2JqZWN0fSBzdG9ja0pzb25cclxuICogQHJldHVybnMge3Vua25vd25bXVtdfVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUHJvZHVjdG9Sb3dzRnJvbVN0b2NrSnNvbihzdG9ja0pzb24pIHtcclxuICBjb25zdCBzaiA9IC8qKiBAdHlwZSB7YW55fSAqLyAoc3RvY2tKc29uKSB8fCB7fTtcclxuICBjb25zdCBzdG9ja01hcCA9IHNqLnN0b2NrIHx8IHt9O1xyXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cclxuICBsZXQgcXVhbnRpdGllcyA9IHt9O1xyXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgbnVtYmVyPj59ICovXHJcbiAgbGV0IGJyZWFrZG93biA9IHt9O1xyXG4gIHRyeSB7XHJcbiAgICBxdWFudGl0aWVzID0gc2oucXVhbnRpdGllcyA/IEpTT04ucGFyc2Uoc2oucXVhbnRpdGllcykgOiBzai5xdWFudGl0aWVzX21hcCB8fCB7fTtcclxuICB9IGNhdGNoIChfKSB7fVxyXG4gIHRyeSB7XHJcbiAgICBicmVha2Rvd24gPSBzai53YXJlaG91c2VCcmVha2Rvd25cclxuICAgICAgPyBKU09OLnBhcnNlKHNqLndhcmVob3VzZUJyZWFrZG93bilcclxuICAgICAgOiBzai53YXJlaG91c2VCcmVha2Rvd25fbWFwIHx8IHt9O1xyXG4gIH0gY2F0Y2ggKF8pIHt9XHJcbiAgY29uc3Qgcm93cyA9IC8qKiBAdHlwZSB7dW5rbm93bltdW119ICovIChbXSk7XHJcbiAgY29uc3Qgc291cmNlID0gJ3N0b2NrLmpzb24gc25hcHNob3QnO1xyXG4gIGNvbnN0IHVwZGF0ZWRBdCA9IHNqLnVwZGF0ZWRBdCB8fCBzai5zbmFwc2hvdEF0IHx8IG51bGw7XHJcbiAgZm9yIChjb25zdCBza3Ugb2YgT2JqZWN0LmtleXMoc3RvY2tNYXApKSB7XHJcbiAgICBjb25zdCBoYXNfc3RvY2sgPSAhIXN0b2NrTWFwW3NrdV07XHJcbiAgICBjb25zdCB0b3RhbCA9IE51bWJlcihxdWFudGl0aWVzW3NrdV0gfHwgMCk7XHJcbiAgICBjb25zdCB3YnMgPSBicmVha2Rvd25bc2t1XSB8fCB7fTtcclxuICAgIGNvbnN0IHcxMSA9IE51bWJlcih3YnNbJzExJ10gfHwgMCk7XHJcbiAgICBjb25zdCB3MTIgPSBOdW1iZXIod2JzWycxMiddIHx8IDApO1xyXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xyXG4gICAgY29uc3Qgb3Ryb3MgPSB7fTtcclxuICAgIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyh3YnMpKSB7XHJcbiAgICAgIGlmIChrICE9PSAnMTEnICYmIGsgIT09ICcxMicpIG90cm9zW2tdID0gTnVtYmVyKHdic1trXSB8fCAwKTtcclxuICAgIH1cclxuICAgIHJvd3MucHVzaChbXHJcbiAgICAgIHNrdSxcclxuICAgICAgaGFzX3N0b2NrLFxyXG4gICAgICB0b3RhbCxcclxuICAgICAgdzExLFxyXG4gICAgICB3MTIsXHJcbiAgICAgIE9iamVjdC5rZXlzKG90cm9zKS5sZW5ndGggPyBvdHJvcyA6IG51bGwsXHJcbiAgICAgIHNvdXJjZSxcclxuICAgICAgdXBkYXRlZEF0LFxyXG4gICAgXSk7XHJcbiAgfVxyXG4gIHJldHVybiByb3dzO1xyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRGlzcGF0Y2hlcjogbWFwYSBjb2xsZWN0aW9uIC0+IHJvdyBidWlsZGVyXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuLy8gdjczMjogYnVpbGRlcnMgcGFyYSBsb3MgMyBzbmFwc2hvdHMgQlEtPkZpcmVzdG9yZS5cclxuXHJcbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2FwU25hcHNob3RSb3dzKGRvYykge1xyXG4gIHJldHVybiBbXHJcbiAgICBbXHJcbiAgICAgIGRvYy5faWQsXHJcbiAgICAgIGRvYy52ZW5kb3JLZXksXHJcbiAgICAgIGRvYy5hbmlvLFxyXG4gICAgICBkb2MubWVzLFxyXG4gICAgICBkb2MuZmFjdHVyYWRvQXJzTmV0byxcclxuICAgICAgZG9jLmZhY3R1cmFkb0Fyc0JydXRvLFxyXG4gICAgICBkb2MubmNzQXJzLFxyXG4gICAgICBkb2MuZmFjdHVyYXNDb3VudCxcclxuICAgICAgZG9jLm5jc0NvdW50LFxyXG4gICAgICBkb2MudW5pZGFkZXNOZXRvLFxyXG4gICAgICBkb2MuaW1wb3J0ZUxpbmVhc0Fyc05ldG8sXHJcbiAgICAgIGRvYy51cGRhdGVkQXQsXHJcbiAgICBdLFxyXG4gIF07XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkRmFjdHVyYWNpb25TbmFwc2hvdFJvd3MoZG9jKSB7XHJcbiAgcmV0dXJuIFtbZG9jLl9pZCwgZG9jLnZlbmRvcktleSwgZG9jLmhveUFycywgZG9jLm1lc0FycywgZG9jLmFub0FycywgZG9jLnVwZGF0ZWRBdF1dO1xyXG59XHJcblxyXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZEJhY2tvcmRlclNuYXBzaG90Um93cyhkb2MpIHtcclxuICBjb25zdCBoZWFkZXIgPSBbZG9jLl9pZCwgZG9jLnZlbmRvcktleSwgZG9jLmxpbmVzQ291bnQsIGRvYy51cGRhdGVkQXRdO1xyXG4gIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShkb2MubGluZXMpID8gZG9jLmxpbmVzIDogW107XHJcbiAgaWYgKCFsaW5lcy5sZW5ndGgpIHtcclxuICAgIHJldHVybiBbXHJcbiAgICAgIGhlYWRlci5jb25jYXQoW1xyXG4gICAgICAgIG51bGwsXHJcbiAgICAgICAgbnVsbCxcclxuICAgICAgICBudWxsLFxyXG4gICAgICAgIG51bGwsXHJcbiAgICAgICAgbnVsbCxcclxuICAgICAgICBudWxsLFxyXG4gICAgICAgIG51bGwsXHJcbiAgICAgICAgbnVsbCxcclxuICAgICAgICBudWxsLFxyXG4gICAgICAgIG51bGwsXHJcbiAgICAgICAgbnVsbCxcclxuICAgICAgICBudWxsLFxyXG4gICAgICAgIG51bGwsXHJcbiAgICAgICAgbnVsbCxcclxuICAgICAgXSksXHJcbiAgICBdO1xyXG4gIH1cclxuICByZXR1cm4gbGluZXMubWFwKCgvKiogQHR5cGUge2FueX0gKi8gbCkgPT5cclxuICAgIGhlYWRlci5jb25jYXQoW1xyXG4gICAgICBsID8gbC5za3UgOiBudWxsLFxyXG4gICAgICBsID8gbC5wcm9kdWN0byA6IG51bGwsXHJcbiAgICAgIGwgPyBsLmZhbWlsaWEgOiBudWxsLFxyXG4gICAgICBsID8gbC5zdWJmYW1pbGlhIDogbnVsbCxcclxuICAgICAgbCA/IGwucGVuZGllbnRlIDogbnVsbCxcclxuICAgICAgbCA/IGwucGVkaWRvIDogbnVsbCxcclxuICAgICAgbCA/IGwuc3RvY2tBY3R1YWwgOiBudWxsLFxyXG4gICAgICBsID8gbC5wcmVjaW9Vbml0YXJpbyA6IG51bGwsXHJcbiAgICAgIGwgPyBsLmNsaWVudGVDb2RlIDogbnVsbCxcclxuICAgICAgbCA/IGwuY2xpZW50ZU5vbWJyZSA6IG51bGwsXHJcbiAgICAgIGwgPyBsLmNsaWVudGVDaXVkYWQgOiBudWxsLFxyXG4gICAgICBsID8gbC5zcURvY051bSA6IG51bGwsXHJcbiAgICAgIGwgPyBsLnNxRG9jRGF0ZSA6IG51bGwsXHJcbiAgICAgIGwgPyBsLmVzdGFkbyA6IG51bGwsXHJcbiAgICBdKVxyXG4gICk7XHJcbn1cclxuXHJcbi8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKGRvYzogYW55KSA9PiB1bmtub3duW11bXT59ICovXHJcbmV4cG9ydCBjb25zdCBST1dfQlVJTERFUlMgPSB7XHJcbiAgcGVkaWRvczogYnVpbGRQZWRpZG9Sb3dzLFxyXG4gIHZpc2l0YXM6IGJ1aWxkVmlzaXRhUm93cyxcclxuICBjbGllbnRlczogYnVpbGRDbGllbnRlUm93cyxcclxuICBjbGllbnRfbWFzdGVyOiBidWlsZENsaWVudE1hc3RlclJvd3MsXHJcbiAgcmVuZGljaW9uZXM6IGJ1aWxkUmVuZGljaW9uUm93cyxcclxuICBjYW1wYW5pYXM6IGJ1aWxkQ2FtcGFuaWFSb3dzLFxyXG4gIHRhcmdldHM6IGJ1aWxkVGFyZ2V0Um93cyxcclxuICB2ZW5kb3Jfb3ZlcnJpZGVzOiBidWlsZFZlbmRvck92ZXJyaWRlUm93cyxcclxuICBjdXN0b21fcm91dGVzOiBidWlsZEN1c3RvbVJvdXRlUm93cyxcclxuICBzZWd1aW1pZW50b19ub3RlczogYnVpbGRTZWd1aW1pZW50b05vdGVSb3dzLFxyXG4gIC8vIHY3MzI6IDMgc25hcHNob3RzIEJRLT5GaXJlc3RvcmUuXHJcbiAgc2FwX3NuYXBzaG90OiBidWlsZFNhcFNuYXBzaG90Um93cyxcclxuICBmYWN0dXJhY2lvbl9zbmFwc2hvdDogYnVpbGRGYWN0dXJhY2lvblNuYXBzaG90Um93cyxcclxuICBiYWNrb3JkZXJfc25hcHNob3Q6IGJ1aWxkQmFja29yZGVyU25hcHNob3RSb3dzLFxyXG59O1xyXG4iLCAiLy8gQHRzLW5vY2hlY2tcclxuLy8gRVhQT1JUUy1BRFZBTkNFRDogcGhvdG8gWklQcywgYXVkaXQgWExTWCwgZXhlY3V0aXZlIHN1bW1hcnksIHZpc2l0cyBYTFNYLFxyXG4vLyBQb3dlckJJIGRhdGFzZXQsIE1MIGRhdGFzZXQuIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAoNCBmcmFnbWVudG9zXHJcbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIEJhY2t1cCArIEF1ZGl0ICsgX2V4cG9ydExlZ2FjeUZ1bGwgcXVlIHF1ZWRhblxyXG4vLyBlbiBlbCBpbmxpbmUpIGNvbW8gcGFydGUgZGUgRTIubi4yIChlMmItcGVyZiAyMDI2LTA3LTI4KS5cclxuLy9cclxuLy8gdjM3MSs6IGV4cG9ydERhdGFzZXRaaXAoKSBudWV2byBcdTIwMTQgWklQIGNvbiBDU1ZzIHBvciBlbnRpZGFkIHBhcmEgcGlwZWxpbmVzXHJcbi8vIE1MIGV4dGVybm9zIChNaWNyb3NvZnQgRmFicmljKS4gSW1wb3J0YSBsb3MgaGVscGVycyBwdXJvcyB5IHNjaGVtYXMgZGVsXHJcbi8vIG1vZHVsbyBzcmMvcHVyZS9jc3Ytc2VyaWFsaXplci5qcy4gVmVyIHBsYW4gY29zbWljLXBvbmRlcmluZy1zdGVhcm5zLm1kLlxyXG5cclxuaW1wb3J0IHtcclxuICBidWlsZENzdixcclxuICBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24sXHJcbiAgY29tcHV0ZU51bGxSYXRlcyxcclxuICBEQVRBU0VUX1NDSEVNQVMsXHJcbiAgREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVgsXHJcbiAgUk9XX0JVSUxERVJTLFxyXG59IGZyb20gJy4uL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMnO1xyXG5cclxuLy9cclxuLy8gRGVwcyBkZWwgaW5saW5lOiBKU1ppcCAoQ0ROIGxhenkpLCBFeGNlbEpTIChDRE4gbGF6eSB2aWEgbG9hZEV4Y2VsSlMpLFxyXG4vLyBYTFNYIChkZWZlciBlbiBoZWFkKSwgdmlzaXRzQ2FjaGUsIGNhbXBhaWduc0NhY2hlLCBvcHNMb2dDYWNoZSAoYXVkaXRcclxuLy8gaW5saW5lKSwgYXVkaXRMb2dDYWNoZSAoYXVkaXQgaW5saW5lKSwgY29udGFjdGVkIChnbG9iYWwgU2V0KSwgUE9JTlRTLFxyXG4vLyBQUk9EVUNUUywgVkVORE9SUywgTUVTRVMsIHZlbmRvckxvb2t1cCwgZXNjYXBlSHRtbCwgZXNjYXBlQXR0ciwgdGl0bGVDYXNlLFxyXG4vLyBzaG93U3luY1RhZywgY3VycmVudFVzZXIsIHVzZXJSb2xlLCBvcmRlcnMsIGNvbmZpcm1lZCwgcGVuZGluZy5cclxuLy9cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUgKHRvZG9zIGxvcyBoZWxwZXJzIHkgY29uc3RzIGxvY2FsZXMgYWwgYmxvcXVlKS5cclxuLy8gU2luIGxpc3RlbmVycyBvblNuYXBzaG90LlxyXG4vL1xyXG4vLyBOT1RBOiBsb3MgaGVscGVycyB0b2RheVN0ci9kYXRhVXJsVG9CbG9iL3Nhbml0aXplRm9yUGF0aCB2aXZlbiBlbiBlc3RlXHJcbi8vIG1cdTAwRjNkdWxvIFx1MjAxNCBlbCBpbmxpbmUgcHVlZGUgbGxhbWFybG9zIHZpYSBmcmVlIHJlZmVyZW5jZSBhbCBHbG9iYWwgRW52aXJvbm1lbnRcclxuLy8gUmVjb3JkIHBlcm8gcHJlZmVyaW1vcyBleHBvc2ljaVx1MDBGM24gd2luZG93LiogZXhwbFx1MDBFRGNpdGEgYWwgZmluYWwuXHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogaGVscGVycyArIHBob3RvcyB6aXAgKyB2aXNpdHMgZW1iZWRkZWQgKGlubGluZSBMOTI1Ni05NDQ1KVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbmZ1bmN0aW9uIHRvZGF5U3RyKCkge1xyXG4gIHJldHVybiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG59XHJcblxyXG4vLyBIZWxwZXI6IGNvbnZlcnRpciBkYXRhVVJMIGJhc2U2NCBhIEJsb2IgcGFyYSBpbmNsdWlyIGVuIFpJUFxyXG5mdW5jdGlvbiBkYXRhVXJsVG9CbG9iKGRhdGFVcmwpIHtcclxuICBpZiAoIWRhdGFVcmwpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IHBhcnRzID0gZGF0YVVybC5zcGxpdCgnLCcpO1xyXG4gIGlmIChwYXJ0cy5sZW5ndGggPCAyKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBtaW1lTWF0Y2ggPSBwYXJ0c1swXS5tYXRjaCgvOiguKj8pOy8pO1xyXG4gIGNvbnN0IG1pbWUgPSBtaW1lTWF0Y2ggPyBtaW1lTWF0Y2hbMV0gOiAnaW1hZ2UvanBlZyc7XHJcbiAgY29uc3QgYnl0ZXMgPSBhdG9iKHBhcnRzWzFdKTtcclxuICBjb25zdCBhcnIgPSBuZXcgVWludDhBcnJheShieXRlcy5sZW5ndGgpO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpKyspIGFycltpXSA9IGJ5dGVzLmNoYXJDb2RlQXQoaSk7XHJcbiAgcmV0dXJuIG5ldyBCbG9iKFthcnJdLCB7IHR5cGU6IG1pbWUgfSk7XHJcbn1cclxuXHJcbi8vIFNhbmVhciBub21icmVzIHBhcmEgcXVlIHNpcnZhbiBjb21vIHJ1dGEgZGUgYXJjaGl2b1xyXG5mdW5jdGlvbiBzYW5pdGl6ZUZvclBhdGgocykge1xyXG4gIHJldHVybiBTdHJpbmcocyB8fCAnJylcclxuICAgIC5yZXBsYWNlKC9bXFxcXC8qP1tcXF06fFwiPD5dL2csICdfJylcclxuICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgIC50cmltKClcclxuICAgIC5zbGljZSgwLCA2MCk7XHJcbn1cclxuXHJcbi8vIERlc2NhcmdhciB0b2RhcyBsYXMgZm90b3MgZGUgdmlzaXRhcyBlbiB1biBaSVAgb3JnYW5pemFkbyBwb3IgdmVuZGVkb3IgLyB0aWVuZGEgLyBmZWNoYVxyXG53aW5kb3cuZXhwb3J0UGhvdG9zWmlwID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIC8vIHY2NzkgUEVSRiBGYXNlIDM6IEpTWmlwIGxhenkgb24tZGVtYW5kXHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IHdpbmRvdy5sb2FkSlNaaXAoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnTm8gc2UgcHVkbyBjYXJnYXIgSlNaaXA6ICcgKyBlLm1lc3NhZ2UpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoIXZpc2l0c0NhY2hlIHx8ICF2aXNpdHNDYWNoZS5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KCdObyBoYXkgdmlzaXRhcyByZWdpc3RyYWRhcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgbGV0IHBob3RvQ291bnQgPSAwO1xyXG4gIGNvbnN0IHppcCA9IG5ldyBKU1ppcCgpO1xyXG4gIHZpc2l0c0NhY2hlLmZvckVhY2goKHYpID0+IHtcclxuICAgIGNvbnN0IHZlbmRvciA9IHNhbml0aXplRm9yUGF0aCh0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJ1NJTl9WRU5ERURPUicpKTtcclxuICAgIGNvbnN0IHRpZW5kYSA9IHNhbml0aXplRm9yUGF0aCh2LnRpZW5kYSB8fCAnc2luX3RpZW5kYScpO1xyXG4gICAgY29uc3QgZmVjaGEgPSAodi5mZWNoYSB8fCAnJykucmVwbGFjZSgvLS9nLCAnJyk7XHJcbiAgICBjb25zdCBmb2xkZXJOYW1lID0gdmVuZG9yICsgJy8nICsgdGllbmRhICsgJ18nICsgZmVjaGE7XHJcbiAgICBjb25zdCBmb2xkZXIgPSB6aXAuZm9sZGVyKGZvbGRlck5hbWUpO1xyXG4gICAgaWYgKHYuZnJlbnRlTG9jYWwpIHtcclxuICAgICAgY29uc3QgYiA9IGRhdGFVcmxUb0Jsb2Iodi5mcmVudGVMb2NhbCk7XHJcbiAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgZm9sZGVyLmZpbGUoJ2ZyZW50ZS5qcGcnLCBiKTtcclxuICAgICAgICBwaG90b0NvdW50Kys7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgICh2LmVzcGFjaW8gfHwgW10pLmZvckVhY2goKGI2NCwgaSkgPT4ge1xyXG4gICAgICBjb25zdCBiID0gZGF0YVVybFRvQmxvYihiNjQpO1xyXG4gICAgICBpZiAoYikge1xyXG4gICAgICAgIGZvbGRlci5maWxlKCdlc3BhY2lvXycgKyAoaSArIDEpICsgJy5qcGcnLCBiKTtcclxuICAgICAgICBwaG90b0NvdW50Kys7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIGlmICghcGhvdG9Db3VudCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSBmb3RvcyBjYXJnYWRhcyBlbiBsYXMgdmlzaXRhcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBaSVAgZGUgJyArIHBob3RvQ291bnQgKyAnIGZvdG9zLi4uJywgMzAwMDApO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBibG9iID0gYXdhaXQgemlwLmdlbmVyYXRlQXN5bmMoeyB0eXBlOiAnYmxvYicsIGNvbXByZXNzaW9uOiAnREVGTEFURScgfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19Gb3Rvc19WaXNpdGFzXycgKyB0b2RheVN0cigpICsgJy56aXAnO1xyXG4gICAgYS5jbGljaygpO1xyXG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xyXG4gICAgc2hvd1N5bmNUYWcocGhvdG9Db3VudCArICcgZm90b3MgZGVzY2FyZ2FkYXMnLCAzMDAwKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCd6aXAnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gWklQOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEV4Y2VsIGNvbiBmb3RvcyBkZWwgZnJlbnRlIGVtYmViaWRhcyBlbiBjYWRhIGNlbGRhIChFeGNlbEpTKVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRXhjZWxKUyBzZSBjYXJnYSBsYXp5IChzb2xvIGN1YW5kbyBzZSB0b2NhIGVsIGJvdG9uKSBwYXJhIG5vIGluZmxhciBlbCBidW5kbGUuXHJcbmZ1bmN0aW9uIGxvYWRFeGNlbEpTKCkge1xyXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICBpZiAodHlwZW9mIEV4Y2VsSlMgIT09ICd1bmRlZmluZWQnKSByZXR1cm4gcmVzb2x2ZSgpO1xyXG4gICAgY29uc3QgcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xyXG4gICAgcy5zcmMgPSAnaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L25wbS9leGNlbGpzQDQuNC4wL2Rpc3QvZXhjZWxqcy5taW4uanMnO1xyXG4gICAgcy5vbmxvYWQgPSAoKSA9PiByZXNvbHZlKCk7XHJcbiAgICBzLm9uZXJyb3IgPSAoKSA9PlxyXG4gICAgICByZWplY3QobmV3IEVycm9yKCdObyBzZSBwdWRvIGNhcmdhciBsYSBsaWJyZXJpYSBFeGNlbEpTLiBSZXZpc2EgdHUgY29uZXhpb24gYSBpbnRlcm5ldC4nKSk7XHJcbiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHMpO1xyXG4gIH0pO1xyXG59XHJcblxyXG53aW5kb3cuZXhwb3J0VmlzaXRzV2l0aEVtYmVkZGVkUGhvdG9zID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICghdmlzaXRzQ2FjaGUgfHwgIXZpc2l0c0NhY2hlLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBuID0gdmlzaXRzQ2FjaGUubGVuZ3RoO1xyXG4gIGlmIChuID4gMzAwKSB7XHJcbiAgICBpZiAoXHJcbiAgICAgICFjb25maXJtKFxyXG4gICAgICAgICdIYXkgJyArXHJcbiAgICAgICAgICBuICtcclxuICAgICAgICAgICcgdmlzaXRhcy4gRWwgRXhjZWwgY29uIHRvZGFzIGxhcyBmb3RvcyBlbWJlYmlkYXMgcHVlZGUgcGVzYXIgNTAtMTUwIE1CIHkgdGFyZGFyIHZhcmlvcyBtaW51dG9zLiBcdTAwQkZDb250aW51YXI/J1xyXG4gICAgICApXHJcbiAgICApXHJcbiAgICAgIHJldHVybjtcclxuICB9IGVsc2UgaWYgKG4gPiAxMDApIHtcclxuICAgIGlmIChcclxuICAgICAgIWNvbmZpcm0oXHJcbiAgICAgICAgJ1ZhcyBhIGdlbmVyYXIgdW4gRXhjZWwgY29uICcgK1xyXG4gICAgICAgICAgbiArXHJcbiAgICAgICAgICAnIHZpc2l0YXMgeSBzdXMgZm90b3MgZW1iZWJpZGFzLiBQdWVkZSB0YXJkYXIgMzAtNjAgc2VndW5kb3MuIFx1MDBCRkNvbnRpbnVhcj8nXHJcbiAgICAgIClcclxuICAgIClcclxuICAgICAgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93U3luY1RhZygnQ2FyZ2FuZG8gRXhjZWxKUy4uLicsIDIwMDApO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgY29uICcgKyBuICsgJyB2aXNpdGFzLi4uJywgMzAwMCk7XHJcblxyXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcclxuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xyXG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdWaXNpdGFzJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XHJcblxyXG4gIC8vIERlZmluaWNpb24gZGUgY29sdW1uYXMuIExhIGNvbHVtbmEgZGUgZm90byB2YSBhIHRlbmVyIGFuY2hvIGV4dHJhIHBhcmEgcXVlIHNlIHZlYS5cclxuICB3cy5jb2x1bW5zID0gW1xyXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ01lcycsIGtleTogJ21lcycsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpcG8gY29udGFjdG8nLCBrZXk6ICd0aXBvQ3QnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnQ29tZW50YXJpbycsIGtleTogJ2NvbWVudCcsIHdpZHRoOiAzMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdQcm92aW5jaWEnLCBrZXk6ICdwcm92aW5jaWEnLCB3aWR0aDogMTYgfSxcclxuICAgIHsgaGVhZGVyOiAnTG9jYWxpZGFkJywga2V5OiAnbG9jYWxpZGFkJywgd2lkdGg6IDE4IH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpZW5kYScsIGtleTogJ3RpZW5kYScsIHdpZHRoOiAzMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdMb2NhbCcsIGtleTogJ2xvY2FsJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1RhbWFubycsIGtleTogJ3RhbWFubycsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdGaWRlbGlkYWQnLCBrZXk6ICdmaWRlbGlkYWQnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnUmVsZXZhbmNpYScsIGtleTogJ3JlbGV2Jywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1BPUCcsIGtleTogJ3BvcCcsIHdpZHRoOiA4IH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpcG8gdmVudGEnLCBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnQ29tcGV0ZW5jaWEnLCBrZXk6ICdjb21wZScsIHdpZHRoOiAxNiB9LFxyXG4gICAgeyBoZWFkZXI6ICdPcG9ydHVuaWRhZCcsIGtleTogJ29wb3J0dScsIHdpZHRoOiAzMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdMbyBtYXMgdmVuZGlkbycsIGtleTogJ21hc1ZlJywgd2lkdGg6IDI4IH0sXHJcbiAgICB7IGhlYWRlcjogJ0dQUyBkaXN0IChtKScsIGtleTogJ2dwc0Rpc3QnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnRm90byBmcmVudGUnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sIC8vIDwtIGxhIGltYWdlbiB2YSBhY2FcclxuICAgIHsgaGVhZGVyOiAnRW1haWwgdmVuZGVkb3InLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxyXG4gIF07XHJcblxyXG4gIC8vIEVzdGlsbyBoZWFkZXJcclxuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XHJcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwQzRBNkUnIH0gfTtcclxuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XHJcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xyXG5cclxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxOyAvLyAwLWluZGV4ZWQgcGFyYSBhZGRJbWFnZVxyXG4gIGNvbnN0IFJPV19IID0gMTAwO1xyXG4gIGNvbnN0IElNR19XID0gMTMwO1xyXG4gIGNvbnN0IElNR19IID0gOTA7XHJcblxyXG4gIC8vIE9yZGVuYXIgdmlzaXRhcyBwb3IgZmVjaGEgZGVzYyAobWFzIHJlY2llbnRlcyBwcmltZXJvKVxyXG4gIGNvbnN0IHNvcnRlZCA9IHZpc2l0c0NhY2hlLnNsaWNlKCkuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xyXG5cclxuICBmb3IgKGNvbnN0IHYgb2Ygc29ydGVkKSB7XHJcbiAgICBjb25zdCB0aXBvQ29udGFjdG9MYmwgPSB2LnRpcG9Db250YWN0byA9PT0gJ3RlbGVmb25vJyA/ICdUZWxlZm9ubycgOiAnUHJlc2VuY2lhbCc7XHJcbiAgICBjb25zdCByID0gd3MuYWRkUm93KHtcclxuICAgICAgZmVjaGE6IHYuZmVjaGEgfHwgJycsXHJcbiAgICAgIG1lczogdi5tZXMgfHwgJycsXHJcbiAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxyXG4gICAgICB0aXBvQ3Q6IHRpcG9Db250YWN0b0xibCxcclxuICAgICAgY29tZW50OiB2LmNvbWVudGFyaW8gfHwgJycsXHJcbiAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcclxuICAgICAgbG9jYWxpZGFkOiB2LmxvY2FsaWRhZCB8fCAnJyxcclxuICAgICAgdGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcclxuICAgICAgdGlwbzogdi50aXBvIHx8ICcnLFxyXG4gICAgICBsb2NhbDogdi5sb2NhbCB8fCAnJyxcclxuICAgICAgdGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcclxuICAgICAgZmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcclxuICAgICAgcmVsZXY6IHYucmVsZXZhbmNpYSB8fCAnJyxcclxuICAgICAgcG9wOiB2LnBvcCB8fCAnJyxcclxuICAgICAgdGlwb1ZlbnRhOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXHJcbiAgICAgIGNvbXBlOiB2LmNvbXBldGVuY2lhIHx8ICcnLFxyXG4gICAgICBvcG9ydHU6IHYub3BvcnR1bmlkYWQgfHwgJycsXHJcbiAgICAgIG1hc1ZlOiB2Lm1hc1ZlbmRpZG8gfHwgJycsXHJcbiAgICAgIGdwc0Rpc3Q6IHR5cGVvZiB2Lmdwc0Rpc3RhbmNlTSA9PT0gJ251bWJlcicgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxyXG4gICAgICBmb3RvOiAnJywgLy8gbGEgY2VsZGEgcXVlZGEgdmFjaWE7IGVuY2ltYSB2YSBsYSBpbWFnZW5cclxuICAgICAgZW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcclxuICAgIH0pO1xyXG4gICAgci5oZWlnaHQgPSBST1dfSDtcclxuICAgIHIuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XHJcbiAgICBpZiAodi5mcmVudGVMb2NhbCAmJiB0eXBlb2Ygdi5mcmVudGVMb2NhbCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBFbCBjYW1wbyBlcyB1biBkYXRhVVJMOiAnZGF0YTppbWFnZS9qcGVnO2Jhc2U2NCwvOWovNEFBUS4uLidcclxuICAgICAgICBsZXQgYjY0ID0gdi5mcmVudGVMb2NhbDtcclxuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xyXG4gICAgICAgIGlmIChtKSB7XHJcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgICAgICBiNjQgPSBtWzJdO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcclxuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XHJcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByLm51bWJlciAtIDEgKyAwLjEgfSxcclxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcclxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gZmlsYScsIHIubnVtYmVyLCBlKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gR2VuZXJhciB5IGRlc2NhcmdhclxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XHJcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcclxuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcclxuICAgIH0pO1xyXG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XHJcbiAgICBhLmhyZWYgPSB1cmw7XHJcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fVmlzaXRhc19jb25fZm90b3NfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnO1xyXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcclxuICAgIGEuY2xpY2soKTtcclxuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XHJcbiAgICBzaG93U3luY1RhZygnRXhjZWwgZGVzY2FyZ2FkbzogJyArIHNvcnRlZC5sZW5ndGggKyAnIHZpc2l0YXMnLCAzMDAwKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRWaXNpdHNXaXRoRW1iZWRkZWRQaG90b3MnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogZXhwb3J0QXVkaXRFeGNlbCAoaW5saW5lIEwxMDA0MC0xMDA2NylcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG53aW5kb3cuZXhwb3J0QXVkaXRFeGNlbCA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGl0ZW1zID0gZ2V0RmlsdGVyZWRBdWRpdEVudHJpZXMoKTtcclxuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSBldmVudG9zIHBhcmEgZXhwb3J0YXIgY29uIGxvcyBmaWx0cm9zIGFwbGljYWRvcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgcm93cyA9IGl0ZW1zLm1hcCgoZSkgPT4ge1xyXG4gICAgY29uc3QgdHMgPSBlLnRpbWVzdGFtcCAmJiBlLnRpbWVzdGFtcC50b0RhdGUgPyBlLnRpbWVzdGFtcC50b0RhdGUoKSA6IG51bGw7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBGZWNoYV9Ib3JhOiB0cyA/IHRzLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgnVCcsICcgJykuc2xpY2UoMCwgMTkpIDogJycsXHJcbiAgICAgIFVzdWFyaW9fRW1haWw6IGUudXNlckVtYWlsIHx8ICcnLFxyXG4gICAgICBVc3VhcmlvX1VJRDogZS51c2VyVWlkIHx8ICcnLFxyXG4gICAgICBSb2w6IGUudXNlclJvbGUgfHwgJycsXHJcbiAgICAgIEFjY2lvbjogQVVESVRfQUNUSU9OX0xBQkVMU1tlLmFjdGlvbl0gfHwgZS5hY3Rpb24gfHwgJycsXHJcbiAgICAgIEFjY2lvbl9SYXc6IGUuYWN0aW9uIHx8ICcnLFxyXG4gICAgICBUaXBvX0VudGlkYWQ6IGUuZW50aXR5VHlwZSB8fCAnJyxcclxuICAgICAgRW50aWRhZDogZS5lbnRpdHlOYW1lIHx8ICcnLFxyXG4gICAgICBEZXRhbGxlc19KU09OOiBlLmRldGFpbHMgPyBKU09OLnN0cmluZ2lmeShlLmRldGFpbHMpIDogJycsXHJcbiAgICB9O1xyXG4gIH0pO1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xyXG4gIHdzWychY29scyddID0gW1xyXG4gICAgeyB3Y2g6IDIwIH0sXHJcbiAgICB7IHdjaDogMzAgfSxcclxuICAgIHsgd2NoOiAzMCB9LFxyXG4gICAgeyB3Y2g6IDEwIH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICAgIHsgd2NoOiAyMCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogNDAgfSxcclxuICAgIHsgd2NoOiA2MCB9LFxyXG4gIF07XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdBdWRpdG9yaWEnKTtcclxuICBjb25zdCBzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX0F1ZGl0b3JpYV8nICsgc3RhbXAgKyAnLnhsc3gnKTtcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gU0VDQ0lcdTAwRDNOOiBidWlsZENvbnRhY3RhZG9zUm93cy9PcHNMb2cvVmlzaXQgKGlubGluZSBMMTAwODEtMTAxNTUpXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuLy8gTGlzdGEgY29tcGxldGEgZGUgY29udGFjdGFkb3MgKGNsaWVudGVzL3Byb3NwZWN0b3MgbWFyY2Fkb3MgY29uIGNoZWNrKVxyXG5mdW5jdGlvbiBidWlsZENvbnRhY3RhZG9zUm93cygpIHtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgY29udGFjdGVkLmZvckVhY2goKGtleSkgPT4ge1xyXG4gICAgY29uc3QgcGFydHMgPSBrZXkuc3BsaXQoJ3wnKTtcclxuICAgIGNvbnN0IHRpcG8gPSBwYXJ0c1swXSxcclxuICAgICAgcHJvdmluY2UgPSBwYXJ0c1sxXSxcclxuICAgICAgbG9jTmFtZSA9IHBhcnRzWzJdLFxyXG4gICAgICBjbGllbnROYW1lID0gcGFydHNbM107XHJcbiAgICBjb25zdCBwdCA9IFBPSU5UUy5maW5kKChwKSA9PiBwLnByb3ZpbmNlID09PSBwcm92aW5jZSAmJiBwLm5hbWUgPT09IGxvY05hbWUpO1xyXG4gICAgY29uc3QgdmVuZG9yID0gcHQgPyBwdC52ZW5kb3IgOiAnJztcclxuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3ZlbmRvcl07XHJcbiAgICByb3dzLnB1c2goe1xyXG4gICAgICBUaXBvOiB0aXBvID09PSAnQycgPyAnQ2xpZW50ZSBhY3R1YWwnIDogJ1Byb3NwZWN0bycsXHJcbiAgICAgIENsaWVudGU6IGNsaWVudE5hbWUsXHJcbiAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHByb3ZpbmNlKSxcclxuICAgICAgTG9jYWxpZGFkOiBsb2NOYW1lLFxyXG4gICAgICBEZXBhcnRhbWVudG86IHB0ID8gcHQuZGVwdCB8fCAnJyA6ICcnLFxyXG4gICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmRvciB8fCAnJyksXHJcbiAgICAgIFpvbmE6IHZtID8gdm0uem9uZSA6ICcnLFxyXG4gICAgICBDb250YWN0YWRvOiAnU2knLFxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgcm93cy5zb3J0KFxyXG4gICAgKGEsIGIpID0+XHJcbiAgICAgIGEuVmVuZGVkb3IubG9jYWxlQ29tcGFyZShiLlZlbmRlZG9yKSB8fFxyXG4gICAgICBhLlByb3ZpbmNpYS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhKSB8fFxyXG4gICAgICBhLkNsaWVudGUubG9jYWxlQ29tcGFyZShiLkNsaWVudGUpXHJcbiAgKTtcclxuICByZXR1cm4gcm93cztcclxufVxyXG5cclxuLy8gTG9nIGRlIG9wZXJhY2lvbmVzIChjYW5jZWxhY2lvbmVzLCBlbGltaW5hY2lvbmVzLCB2dWVsdmUtYS1ib3JyYWRvciwgZXRjLilcclxuZnVuY3Rpb24gYnVpbGRPcHNMb2dSb3dzKCkge1xyXG4gIHJldHVybiAob3BzTG9nQ2FjaGUgfHwgW10pLm1hcCgobykgPT4gKHtcclxuICAgIEZlY2hhOiBvLnRpbWVzdGFtcFxyXG4gICAgICA/IG8udGltZXN0YW1wLnRvRGF0ZVxyXG4gICAgICAgID8gby50aW1lc3RhbXAudG9EYXRlKCkudG9Mb2NhbGVTdHJpbmcoKVxyXG4gICAgICAgIDogbmV3IERhdGUoby50aW1lc3RhbXApLnRvTG9jYWxlU3RyaW5nKClcclxuICAgICAgOiAnJyxcclxuICAgIFVzdWFyaW86IG8udXNlckVtYWlsIHx8ICcnLFxyXG4gICAgUm9sOiBvLnVzZXJSb2xlIHx8ICcnLFxyXG4gICAgQWNjaW9uOiBvLmFjdGlvbiB8fCAnJyxcclxuICAgICdUaXBvIGVudGlkYWQnOiBvLmVudGl0eVR5cGUgfHwgJycsXHJcbiAgICBFbnRpZGFkOiBvLmVudGl0eU5hbWUgfHwgJycsXHJcbiAgICBEZXRhbGxlczogdHlwZW9mIG8uZGV0YWlscyA9PT0gJ29iamVjdCcgPyBKU09OLnN0cmluZ2lmeShvLmRldGFpbHMpIDogby5kZXRhaWxzIHx8ICcnLFxyXG4gIH0pKTtcclxufVxyXG5cclxuZnVuY3Rpb24gYnVpbGRWaXNpdFJvd3MoKSB7XHJcbiAgcmV0dXJuIHZpc2l0c0NhY2hlLm1hcCgodikgPT4gKHtcclxuICAgIEZlY2hhOiB2LmZlY2hhIHx8ICcnLFxyXG4gICAgTWVzOiB2Lm1lcyB8fCAnJyxcclxuICAgIEFubzogdi5hbmlvIHx8ICcnLFxyXG4gICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnJyksXHJcbiAgICAnVGlwbyBjb250YWN0byc6IHYudGlwb0NvbnRhY3RvID09PSAndGVsZWZvbm8nID8gJ1RlbGVmb25vJyA6ICdQcmVzZW5jaWFsJyxcclxuICAgIENvbWVudGFyaW86IHYuY29tZW50YXJpbyB8fCAnJyxcclxuICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcclxuICAgIExvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXHJcbiAgICBUaWVuZGE6IHYudGllbmRhIHx8ICcnLFxyXG4gICAgJ1RpcG8gdGllbmRhJzogdi50aXBvIHx8ICcnLFxyXG4gICAgTG9jYWw6IHYubG9jYWwgfHwgJycsXHJcbiAgICBUYW1hbm86IHYudGFtYW5vIHx8ICcnLFxyXG4gICAgRmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcclxuICAgICdSZWxldmFuY2lhICgxLTUpJzogdi5yZWxldmFuY2lhIHx8ICcnLFxyXG4gICAgUE9QOiB2LnBvcCB8fCAnJyxcclxuICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IHYubmVjZXNpZGFkUHVudHVhbCA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi5uZWNlc2lkYWRQdW50dWFsIHx8ICcnLFxyXG4gICAgJ1RpcG8gdmVudGEnOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXHJcbiAgICAnJSBNb3N0cmFkb3InOiB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IHYucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxyXG4gICAgJyUgRWNvbW1lcmNlJzogdi5wb25kZXJhY2lvbkVjb21tZXJjZSAhPSBudWxsID8gdi5wb25kZXJhY2lvbkVjb21tZXJjZSA6ICcnLFxyXG4gICAgQ29tcGV0ZW5jaWE6IHYuY29tcGV0ZW5jaWEgfHwgJycsXHJcbiAgICAnQ2F0ZWdvcmlhIGNsaWVudGUnOiB2LmNhdGVnb3JpYUNsaWVudGUgfHwgJycsXHJcbiAgICBPcG9ydHVuaWRhZDogdi5vcG9ydHVuaWRhZCB8fCAnJyxcclxuICAgICdMbyBtYXMgdmVuZGlkbyBTaGltYW5vJzogdi5tYXNWZW5kaWRvIHx8ICcnLFxyXG4gICAgJ0xvIHF1ZSBtYXMgcHJlZ3VudGFuJzogdi5tYXNQcmVndW50YW4gfHwgJycsXHJcbiAgICAnQXl1ZGEgYSB0aWVuZGEnOiB2LmF5dWRhVGllbmRhIHx8ICcnLFxyXG4gICAgJ0ZvdG9zIGVzcGFjaW8gKGNhbnQpJzogKHYuZXNwYWNpbyB8fCBbXSkubGVuZ3RoLFxyXG4gICAgJ0ZvdG8gZnJlbnRlJzogdi5mcmVudGVMb2NhbCA/ICdTaScgOiAnTm8nLFxyXG4gICAgJ0dQUyBlc3RhZG8nOiB2Lmdwc1N0YXR1cyB8fCAnJyxcclxuICAgICdHUFMgZGlzdGFuY2lhIChtKSc6IHR5cGVvZiB2Lmdwc0Rpc3RhbmNlTSA9PT0gJ251bWJlcicgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxyXG4gICAgJ0dQUyBsYXQnOiB2Lmdwc0xhdCAhPSBudWxsID8gdi5ncHNMYXQgOiAnJyxcclxuICAgICdHUFMgbG9uJzogdi5ncHNMb24gIT0gbnVsbCA/IHYuZ3BzTG9uIDogJycsXHJcbiAgICAnR1BTIHByZWNpc2lvbiAobSknOiB2Lmdwc0FjY3VyYWN5ICE9IG51bGwgPyB2Lmdwc0FjY3VyYWN5IDogJycsXHJcbiAgICAnR1BTIGNhcHR1cmFkbyc6IHYuZ3BzQ2FwdHVyZWRBdCB8fCAnJyxcclxuICAgIEVtYWlsOiB2Lm93bmVyRW1haWwgfHwgJycsXHJcbiAgfSkpO1xyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogZXhwb3J0RXhlY3V0aXZlL1Zpc2l0cy9Qb3dlckJJL01MIChpbmxpbmUgTDEwMTU4LTEwNDI2KVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbndpbmRvdy5leHBvcnRFeGVjdXRpdmUgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgY29uc3Qgcm93cyA9IGJ1aWxkUGVkaWRvRGV0YWlsUm93cygpO1xyXG4gIGNvbnN0IGNvbmZSb3dzID0gcm93cy5maWx0ZXIoKHIpID0+IHIuZXN0YWRvID09PSAnQ29uZmlybWFkbycpO1xyXG5cclxuICAvLyBDb25zb2xpZGFkbzogdW5hIGZpbGEgcG9yIHZlbmRlZG9yIGNvbiBLUElzXHJcbiAgY29uc3QgcGVyVmVuZG9yID0ge307XHJcbiAgY29uZlJvd3MuZm9yRWFjaCgocikgPT4ge1xyXG4gICAgY29uc3QgayA9IHIudmVuZGVkb3IgfHwgJ1NpbiBhc2lnbmFyJztcclxuICAgIGlmICghcGVyVmVuZG9yW2tdKVxyXG4gICAgICBwZXJWZW5kb3Jba10gPSB7XHJcbiAgICAgICAgem9uYTogci56b25hLFxyXG4gICAgICAgIHVuaWQ6IDAsXHJcbiAgICAgICAgYXJzOiAwLFxyXG4gICAgICAgIHVzZDogMCxcclxuICAgICAgICBjbGllbnRlczogbmV3IFNldCgpLFxyXG4gICAgICAgIHByb2RzOiBuZXcgU2V0KCksXHJcbiAgICAgICAgcHJvdnM6IG5ldyBTZXQoKSxcclxuICAgICAgfTtcclxuICAgIHBlclZlbmRvcltrXS51bmlkICs9IHIuY2FudGlkYWQ7XHJcbiAgICBwZXJWZW5kb3Jba10uYXJzICs9IHIuc3VidG90YWxfYXJzO1xyXG4gICAgcGVyVmVuZG9yW2tdLnVzZCArPSByLnN1YnRvdGFsX3VzZDtcclxuICAgIHBlclZlbmRvcltrXS5jbGllbnRlcy5hZGQoci5jbGllbnRlKTtcclxuICAgIHBlclZlbmRvcltrXS5wcm9kcy5hZGQoci5jb2RpZ28pO1xyXG4gICAgcGVyVmVuZG9yW2tdLnByb3ZzLmFkZChyLnByb3ZpbmNpYSk7XHJcbiAgfSk7XHJcbiAgY29uc3QgY29uc29sID0gW107XHJcbiAgVkVORE9SUy5mb3JFYWNoKCh2KSA9PiB7XHJcbiAgICBjb25zdCB0aXRsZVYgPSB0aXRsZUNhc2Uodi5rZXkpO1xyXG4gICAgY29uc3QgZCA9IHBlclZlbmRvclt0aXRsZVZdIHx8IHtcclxuICAgICAgem9uYTogdi56b25lLFxyXG4gICAgICB1bmlkOiAwLFxyXG4gICAgICBhcnM6IDAsXHJcbiAgICAgIHVzZDogMCxcclxuICAgICAgY2xpZW50ZXM6IG5ldyBTZXQoKSxcclxuICAgICAgcHJvZHM6IG5ldyBTZXQoKSxcclxuICAgICAgcHJvdnM6IG5ldyBTZXQoKSxcclxuICAgIH07XHJcbiAgICBjb25zdCB0ID0gVEFSR0VUU19CWV9WRU5ET1Jbdi5rZXldIHx8IHsganVsMjAyNl91c2Q6IDAsIGp1bERpYzIwMjZfdXNkOiAwLCBhbnVhbDIwMjdfdXNkOiAwIH07XHJcbiAgICBjb25zb2wucHVzaCh7XHJcbiAgICAgIFpvbmE6IHYuem9uZSxcclxuICAgICAgVmVuZGVkb3I6IHRpdGxlVixcclxuICAgICAgUHJvdmluY2lhczogZC5wcm92cy5zaXplLFxyXG4gICAgICAnQ2xpZW50ZXMgYWN0aXZvcyc6IGQuY2xpZW50ZXMuc2l6ZSxcclxuICAgICAgJ1Byb2R1Y3RvcyBkaXN0aW50b3MnOiBkLnByb2RzLnNpemUsXHJcbiAgICAgIFVuaWRhZGVzOiBkLnVuaWQsXHJcbiAgICAgICdGYWN0dXJhZG8gQVJTJzogTWF0aC5yb3VuZChkLmFycyksXHJcbiAgICAgICdGYWN0dXJhZG8gVVNEJzogTWF0aC5yb3VuZChkLnVzZCksXHJcbiAgICAgICdUYXJnZXQgSnVsIDIwMjYgVVNEJzogdC5qdWwyMDI2X3VzZCxcclxuICAgICAgJ1RhcmdldCBKdWwtRGljIDIwMjYgVVNEJzogdC5qdWxEaWMyMDI2X3VzZCxcclxuICAgICAgJ1RhcmdldCAyMDI3IFVTRCc6IHQuYW51YWwyMDI3X3VzZCxcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHdzQyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb25zb2wpO1xyXG4gIHdzQ1snIWNvbHMnXSA9IFtcclxuICAgIHsgd2NoOiA2IH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICAgIHsgd2NoOiAxMSB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMTYgfSxcclxuICAgIHsgd2NoOiAxMSB9LFxyXG4gICAgeyB3Y2g6IDE2IH0sXHJcbiAgICB7IHdjaDogMTYgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDIwIH0sXHJcbiAgICB7IHdjaDogMTggfSxcclxuICBdO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzQywgJ0NvbnNvbGlkYWRvJyk7XHJcblxyXG4gIC8vIFVuYSBob2phIHBvciB2ZW5kZWRvciBjb24gc3UgZGV0YWxsZSBkZSBwZWRpZG9zIGNvbmZpcm1hZG9zXHJcbiAgVkVORE9SUy5mb3JFYWNoKCh2KSA9PiB7XHJcbiAgICBjb25zdCB0aXRsZVYgPSB0aXRsZUNhc2Uodi5rZXkpO1xyXG4gICAgY29uc3QgdnJvd3MgPSBjb25mUm93c1xyXG4gICAgICAuZmlsdGVyKChyKSA9PiByLnZlbmRlZG9yID09PSB0aXRsZVYpXHJcbiAgICAgIC5tYXAoKHIpID0+ICh7XHJcbiAgICAgICAgRmVjaGE6IHIuZmVjaGEsXHJcbiAgICAgICAgTWVzOiByLm1lc19wZWRpZG8sXHJcbiAgICAgICAgUHJvdmluY2lhOiByLnByb3ZpbmNpYSxcclxuICAgICAgICBMb2NhbGlkYWQ6IHIubG9jYWxpZGFkLFxyXG4gICAgICAgIENsaWVudGU6IHIuY2xpZW50ZSxcclxuICAgICAgICBUaXBvOiByLnRpcG9fY2xpZW50ZSxcclxuICAgICAgICBDb2RpZ286IHIuY29kaWdvLFxyXG4gICAgICAgIFByb2R1Y3RvOiByLnByb2R1Y3RvLFxyXG4gICAgICAgIENhdGVnb3JpYTogci5jYXRlZ29yaWEsXHJcbiAgICAgICAgRmFtaWxpYTogci5mYW1pbGlhLFxyXG4gICAgICAgIFN1YmZhbWlsaWE6IHIuc3ViZmFtaWxpYSxcclxuICAgICAgICBDYW50aWRhZDogci5jYW50aWRhZCxcclxuICAgICAgICAnUHJlY2lvIEFSUyc6IHIucHJlY2lvX3VuaXRfYXJzLFxyXG4gICAgICAgICdTdWJ0b3RhbCBBUlMnOiByLnN1YnRvdGFsX2FycyxcclxuICAgICAgICAnU3VidG90YWwgVVNEJzogci5zdWJ0b3RhbF91c2QsXHJcbiAgICAgIH0pKTtcclxuICAgIHZyb3dzLnNvcnQoXHJcbiAgICAgIChhLCBiKSA9PiAoYS5GZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShiLkZlY2hhIHx8ICcnKSB8fCBhLkNsaWVudGUubG9jYWxlQ29tcGFyZShiLkNsaWVudGUpXHJcbiAgICApO1xyXG4gICAgaWYgKCF2cm93cy5sZW5ndGgpXHJcbiAgICAgIHZyb3dzLnB1c2goe1xyXG4gICAgICAgIEZlY2hhOiAnJyxcclxuICAgICAgICBNZXM6ICcnLFxyXG4gICAgICAgIFByb3ZpbmNpYTogJycsXHJcbiAgICAgICAgTG9jYWxpZGFkOiAnJyxcclxuICAgICAgICBDbGllbnRlOiAnKHNpbiBwZWRpZG9zIGNvbmZpcm1hZG9zKScsXHJcbiAgICAgICAgVGlwbzogJycsXHJcbiAgICAgICAgQ29kaWdvOiAnJyxcclxuICAgICAgICBQcm9kdWN0bzogJycsXHJcbiAgICAgICAgQ2F0ZWdvcmlhOiAnJyxcclxuICAgICAgICBGYW1pbGlhOiAnJyxcclxuICAgICAgICBTdWJmYW1pbGlhOiAnJyxcclxuICAgICAgICBDYW50aWRhZDogMCxcclxuICAgICAgICAnUHJlY2lvIEFSUyc6IDAsXHJcbiAgICAgICAgJ1N1YnRvdGFsIEFSUyc6IDAsXHJcbiAgICAgICAgJ1N1YnRvdGFsIFVTRCc6IDAsXHJcbiAgICAgIH0pO1xyXG4gICAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodnJvd3MpO1xyXG4gICAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICAgIHsgd2NoOiAxMSB9LFxyXG4gICAgICB7IHdjaDogMTQgfSxcclxuICAgICAgeyB3Y2g6IDE4IH0sXHJcbiAgICAgIHsgd2NoOiAyMiB9LFxyXG4gICAgICB7IHdjaDogMzAgfSxcclxuICAgICAgeyB3Y2g6IDExIH0sXHJcbiAgICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgICB7IHdjaDogMzggfSxcclxuICAgICAgeyB3Y2g6IDE0IH0sXHJcbiAgICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgICB7IHdjaDogMTggfSxcclxuICAgICAgeyB3Y2g6IDEwIH0sXHJcbiAgICAgIHsgd2NoOiAxMiB9LFxyXG4gICAgICB7IHdjaDogMTQgfSxcclxuICAgICAgeyB3Y2g6IDE0IH0sXHJcbiAgICBdO1xyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldChcclxuICAgICAgd2IsXHJcbiAgICAgIHdzLFxyXG4gICAgICAodi56b25lICsgJyAnICsgdGl0bGVWKS5zdWJzdHJpbmcoMCwgMzEpLnJlcGxhY2UoL1tcXFxcLyo/W1xcXTpdL2csICcnKVxyXG4gICAgKTtcclxuICB9KTtcclxuXHJcbiAgLy8gVmlzaXRhc1xyXG4gIGNvbnN0IHZpc2l0Um93cyA9IGJ1aWxkVmlzaXRSb3dzKCk7XHJcbiAgaWYgKHZpc2l0Um93cy5sZW5ndGgpIHtcclxuICAgIGNvbnN0IHdzViA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3MpO1xyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NWLCAnVmlzaXRhcycpO1xyXG4gIH1cclxuICAvLyBDb250YWN0YWRvcyAodG9kb3MgbG9zIGNsaWVudGVzL3Byb3NwZWN0b3MgbWFyY2Fkb3MgY29uIGNoZWNrKVxyXG4gIGNvbnN0IGNvbnRhY3RSb3dzID0gYnVpbGRDb250YWN0YWRvc1Jvd3MoKTtcclxuICBpZiAoY29udGFjdFJvd3MubGVuZ3RoKSB7XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoY29udGFjdFJvd3MpLCAnQ29udGFjdGFkb3MnKTtcclxuICB9XHJcbiAgLy8gTG9nIGRlIG9wZXJhY2lvbmVzIChjYW5jZWxhY2lvbmVzLCBlbGltaW5hY2lvbmVzLCBldGMuKVxyXG4gIGNvbnN0IG9wc1Jvd3MgPSBidWlsZE9wc0xvZ1Jvd3MoKTtcclxuICBpZiAob3BzUm93cy5sZW5ndGgpIHtcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChvcHNSb3dzKSwgJ0xvZyBPcGVyYWNpb25lcycpO1xyXG4gIH1cclxuXHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX0VqZWN1dGl2b18nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gLS0tLS0tLS0tLSBFeGNlbCBkZSBWaXNpdGFzIChmb3JtYXRvIHN0YW5kYWxvbmUpIC0tLS0tLS0tLS1cclxud2luZG93LmV4cG9ydFZpc2l0c0V4Y2VsID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHZpc2l0Um93cyA9IGJ1aWxkVmlzaXRSb3dzKCk7XHJcbiAgaWYgKCF2aXNpdFJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzIHRvZGF2aWEuIEN1YW5kbyBzZSBjYXJndWUgYWwgbWVub3MgdW5hLCB2YXMgYSBwb2RlciBleHBvcnRhcmxhLidcclxuICAgICk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG5cclxuICAvLyBIb2phIHByaW5jaXBhbDogVmlzaXRhcyAodG9kYXMgbGFzIGZpbGFzKVxyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93cyk7XHJcbiAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICB7IHdjaDogMTIgfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDggfSxcclxuICAgIHsgd2NoOiAyNCB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMjIgfSxcclxuICAgIHsgd2NoOiAzMCB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMTYgfSxcclxuICAgIHsgd2NoOiA4IH0sXHJcbiAgICB7IHdjaDogMjIgfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMzIgfSxcclxuICAgIHsgd2NoOiAzMiB9LFxyXG4gICAgeyB3Y2g6IDMyIH0sXHJcbiAgICB7IHdjaDogMzIgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICBdO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnVmlzaXRhcycpO1xyXG5cclxuICAvLyBIb2phIHJlc3VtZW4gcG9yIHZlbmRlZG9yOiBjYW50aWRhZCBkZSB2aXNpdGFzIHkgdGllbmRhcyB1bmljYXNcclxuICBjb25zdCBwZXJWZW5kb3IgPSB7fTtcclxuICB2aXNpdHNDYWNoZS5mb3JFYWNoKCh2KSA9PiB7XHJcbiAgICBjb25zdCBrID0gdGl0bGVDYXNlKHYudmVuZG9yIHx8ICdTaW4gYXNpZ25hcicpO1xyXG4gICAgaWYgKCFwZXJWZW5kb3Jba10pXHJcbiAgICAgIHBlclZlbmRvcltrXSA9IHtcclxuICAgICAgICB2aXNpdGFzOiAwLFxyXG4gICAgICAgIHRpZW5kYXM6IG5ldyBTZXQoKSxcclxuICAgICAgICBsb2NhbGlkYWRlczogbmV3IFNldCgpLFxyXG4gICAgICAgIHByb3ZpbmNpYXM6IG5ldyBTZXQoKSxcclxuICAgICAgfTtcclxuICAgIHBlclZlbmRvcltrXS52aXNpdGFzKys7XHJcbiAgICBpZiAodi50aWVuZGEpIHBlclZlbmRvcltrXS50aWVuZGFzLmFkZCh2LnRpZW5kYSk7XHJcbiAgICBpZiAodi5sb2NhbGlkYWQpIHBlclZlbmRvcltrXS5sb2NhbGlkYWRlcy5hZGQodi5sb2NhbGlkYWQpO1xyXG4gICAgaWYgKHYucHJvdmluY2lhKSBwZXJWZW5kb3Jba10ucHJvdmluY2lhcy5hZGQodi5wcm92aW5jaWEpO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHJlc3VtZW4gPSBPYmplY3QuZW50cmllcyhwZXJWZW5kb3IpXHJcbiAgICAubWFwKChbdmVuZGVkb3IsIGRdKSA9PiAoe1xyXG4gICAgICBWZW5kZWRvcjogdmVuZGVkb3IsXHJcbiAgICAgICdWaXNpdGFzIHRvdGFsZXMnOiBkLnZpc2l0YXMsXHJcbiAgICAgICdUaWVuZGFzIGRpc3RpbnRhcyc6IGQudGllbmRhcy5zaXplLFxyXG4gICAgICAnTG9jYWxpZGFkZXMgZGlzdGludGFzJzogZC5sb2NhbGlkYWRlcy5zaXplLFxyXG4gICAgICAnUHJvdmluY2lhcyBkaXN0aW50YXMnOiBkLnByb3ZpbmNpYXMuc2l6ZSxcclxuICAgIH0pKVxyXG4gICAgLnNvcnQoKGEsIGIpID0+IGJbJ1Zpc2l0YXMgdG90YWxlcyddIC0gYVsnVmlzaXRhcyB0b3RhbGVzJ10pO1xyXG4gIGlmIChyZXN1bWVuLmxlbmd0aCkge1xyXG4gICAgY29uc3Qgd3NSID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJlc3VtZW4pO1xyXG4gICAgd3NSWychY29scyddID0gW3sgd2NoOiAyNCB9LCB7IHdjaDogMTYgfSwgeyB3Y2g6IDE4IH0sIHsgd2NoOiAyMiB9LCB7IHdjaDogMjIgfV07XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1IsICdSZXN1bWVuIHBvciB2ZW5kZWRvcicpO1xyXG4gIH1cclxuXHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX1Zpc2l0YXNfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnKTtcclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0gT1BDSU9OIEI6IFBvd2VyIEJJIChGYWN0ICsgRGltKSAtLS0tLS0tLS0tXHJcbndpbmRvdy5leHBvcnRQb3dlckJJID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcclxuXHJcbiAgLy8gRmFjdF9QZWRpZG9zXHJcbiAgY29uc3QgZmFjdFJvd3MgPSByb3dzLmZpbHRlcigocikgPT4gci5lc3RhZG8gIT09ICdCb3JyYWRvcicpO1xyXG4gIGNvbnN0IHdzRiA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChcclxuICAgIGZhY3RSb3dzLm1hcCgocikgPT4gKHtcclxuICAgICAgbGluZV9pZDogci5saW5lX2lkLFxyXG4gICAgICBmZWNoYTogci5mZWNoYSxcclxuICAgICAgZXN0YWRvOiByLmVzdGFkbyxcclxuICAgICAgdmVuZGVkb3Jfa2V5OiByLnZlbmRlZG9yX2tleSxcclxuICAgICAgem9uYTogci56b25hLFxyXG4gICAgICBwcm92aW5jaWE6IHIucHJvdmluY2lhLFxyXG4gICAgICBsb2NhbGlkYWQ6IHIubG9jYWxpZGFkLFxyXG4gICAgICBjbGllbnRlOiByLmNsaWVudGUsXHJcbiAgICAgIHRpcG9fY2xpZW50ZTogci50aXBvX2NsaWVudGUsXHJcbiAgICAgIHNrdTogci5jb2RpZ28sXHJcbiAgICAgIGNhbnRpZGFkOiByLmNhbnRpZGFkLFxyXG4gICAgICBwcmVjaW9fdW5pdF9hcnM6IHIucHJlY2lvX3VuaXRfYXJzLFxyXG4gICAgICBzdWJ0b3RhbF9hcnM6IHIuc3VidG90YWxfYXJzLFxyXG4gICAgICBzdWJ0b3RhbF91c2Q6IHIuc3VidG90YWxfdXNkLFxyXG4gICAgfSkpXHJcbiAgKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c0YsICdGYWN0X1BlZGlkb3MnKTtcclxuXHJcbiAgLy8gRGltX1ZlbmRlZG9yXHJcbiAgY29uc3QgZGltViA9IFZFTkRPUlMubWFwKCh2KSA9PiB7XHJcbiAgICBjb25zdCB0ID0gVEFSR0VUU19CWV9WRU5ET1Jbdi5rZXldIHx8IHt9O1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgdmVuZGVkb3Jfa2V5OiB2LmtleSxcclxuICAgICAgdmVuZGVkb3Jfbm9tYnJlOiB0aXRsZUNhc2Uodi5rZXkpLFxyXG4gICAgICB6b25hOiB2LnpvbmUsXHJcbiAgICAgIHpvbmFfZGVzY3JpcGNpb246IHYubGFiZWwsXHJcbiAgICAgIGNvbG9yOiB2LmNvbG9yLFxyXG4gICAgICB0YXJnZXRfanVsMjAyNl91c2Q6IHQuanVsMjAyNl91c2QgfHwgMCxcclxuICAgICAgdGFyZ2V0X2p1bERpYzIwMjZfdXNkOiB0Lmp1bERpYzIwMjZfdXNkIHx8IDAsXHJcbiAgICAgIHRhcmdldF8yMDI3X3VzZDogdC5hbnVhbDIwMjdfdXNkIHx8IDAsXHJcbiAgICB9O1xyXG4gIH0pO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1WKSwgJ0RpbV9WZW5kZWRvcicpO1xyXG5cclxuICAvLyBEaW1fUHJvZHVjdG9cclxuICBjb25zdCBkaW1QID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xyXG4gICAgc2t1OiBwLmNvZGUsXHJcbiAgICBkZXNjcmlwY2lvbjogcC5kZXNjLFxyXG4gICAgY2F0ZWdvcmlhOiBwLmNhdCxcclxuICAgIGZhbWlsaWE6IHAuZmFtLFxyXG4gICAgc3ViZmFtaWxpYTogcC5zdWIsXHJcbiAgfSkpO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1QKSwgJ0RpbV9Qcm9kdWN0bycpO1xyXG5cclxuICAvLyBEaW1fQ2xpZW50ZSAodW5pdmVyc28pXHJcbiAgY29uc3QgZGltQyA9IFtdO1xyXG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XHJcbiAgICBjb25zdCB2bSA9IHZlbmRvckxvb2t1cFtwLnZlbmRvcl07XHJcbiAgICBwLmNsaWVudHMuZm9yRWFjaCgobikgPT4ge1xyXG4gICAgICBkaW1DLnB1c2goe1xyXG4gICAgICAgIGNsaWVudGU6IG4sXHJcbiAgICAgICAgdGlwbzogJ0NsaWVudGUgYWN0dWFsJyxcclxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcclxuICAgICAgICBsb2NhbGlkYWQ6IHAubmFtZSxcclxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcclxuICAgICAgICB2ZW5kZWRvcl9rZXk6IHAudmVuZG9yIHx8ICcnLFxyXG4gICAgICAgIHpvbmE6IHZtID8gdm0uem9uZSA6ICcnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gICAgcC5wcm9zcGVjdHMuZm9yRWFjaCgobikgPT4ge1xyXG4gICAgICBkaW1DLnB1c2goe1xyXG4gICAgICAgIGNsaWVudGU6IG4sXHJcbiAgICAgICAgdGlwbzogJ1Byb3NwZWN0bycsXHJcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXHJcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXHJcbiAgICAgICAgZGVwYXJ0YW1lbnRvOiBwLmRlcHQgfHwgJycsXHJcbiAgICAgICAgdmVuZGVkb3Jfa2V5OiBwLnZlbmRvciB8fCAnJyxcclxuICAgICAgICB6b25hOiB2bSA/IHZtLnpvbmUgOiAnJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltQyksICdEaW1fQ2xpZW50ZScpO1xyXG5cclxuICAvLyBEaW1fQ2FsZW5kYXJpbyAoZmVjaGFzIGRpc3RpbnRhcyBlbiBsb3MgcGVkaWRvcyArIHNlcmllIGNvbnRpbnVhIGRlbCBhXHUwMEYxbyBhY3R1YWwpXHJcbiAgY29uc3QgY2FsU2V0ID0gbmV3IFNldCgpO1xyXG4gIGZhY3RSb3dzLmZvckVhY2goKHIpID0+IHtcclxuICAgIGlmIChyLmZlY2hhKSBjYWxTZXQuYWRkKHIuZmVjaGEpO1xyXG4gIH0pO1xyXG4gIC8vIENvbXBsZXRhciBkZXNkZSAyMDI2LTAxLTAxIGhhc3RhIGhveSArIDM2NVxyXG4gIGNvbnN0IHN0YXJ0ID0gbmV3IERhdGUoJzIwMjYtMDEtMDEnKTtcclxuICBjb25zdCBlbmQgPSBuZXcgRGF0ZSgpO1xyXG4gIGVuZC5zZXREYXRlKGVuZC5nZXREYXRlKCkgKyAzNjUpO1xyXG4gIGZvciAobGV0IGQgPSBuZXcgRGF0ZShzdGFydCk7IGQgPD0gZW5kOyBkLnNldERhdGUoZC5nZXREYXRlKCkgKyAxKSlcclxuICAgIGNhbFNldC5hZGQoZC50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSk7XHJcbiAgY29uc3QgZGltQ2FsID0gWy4uLmNhbFNldF0uc29ydCgpLm1hcCgoZHQpID0+IHtcclxuICAgIGNvbnN0IFt5LCBtLCBkYV0gPSBkdC5zcGxpdCgnLScpLm1hcCgoeCkgPT4gcGFyc2VJbnQoeCwgMTApKTtcclxuICAgIGNvbnN0IGRhdGVPYmogPSBuZXcgRGF0ZSh5LCBtIC0gMSwgZGEpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgZmVjaGE6IGR0LFxyXG4gICAgICB5ZWFyOiB5LFxyXG4gICAgICBtb250aDogbSxcclxuICAgICAgZGF5OiBkYSxcclxuICAgICAgcXVhcnRlcjogJ1EnICsgKE1hdGguZmxvb3IoKG0gLSAxKSAvIDMpICsgMSksXHJcbiAgICAgIG1vbnRoX25hbWU6IE1FU0VTW20gLSAxXSxcclxuICAgICAgeWVhcl9tb250aDogeSArICctJyArIFN0cmluZyhtKS5wYWRTdGFydCgyLCAnMCcpLFxyXG4gICAgICBkYXlfb2Zfd2VlazogWydEb20nLCAnTHVuJywgJ01hcicsICdNaWUnLCAnSnVlJywgJ1ZpZScsICdTYWInXVtkYXRlT2JqLmdldERheSgpXSxcclxuICAgIH07XHJcbiAgfSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbUNhbCksICdEaW1fQ2FsZW5kYXJpbycpO1xyXG5cclxuICAvLyBEaW1fQ2FtcGFuaWFcclxuICBjb25zdCBkaW1DbXAgPSBjYW1wYWlnbnNDYWNoZS5tYXAoKGMpID0+ICh7XHJcbiAgICBjYW1wYW5pYV9pZDogYy5pZCxcclxuICAgIG5vbWJyZTogYy5uYW1lLFxyXG4gICAgZmlsdGVyX3R5cGU6IGMuZmlsdGVyVHlwZSxcclxuICAgIGZpbHRlcl92YWx1ZXM6IChjLmZpbHRlclZhbHVlcyB8fCBbXSkuam9pbignLCAnKSxcclxuICAgIHRhcmdldF90eXBlOiBjLnRhcmdldFR5cGUsXHJcbiAgICB0YXJnZXRfYW1vdW50OiBjLnRhcmdldEFtb3VudCxcclxuICAgIGRlc2RlOiBjLnN0YXJ0RGF0ZSxcclxuICAgIGhhc3RhOiBjLmVuZERhdGUsXHJcbiAgfSkpO1xyXG4gIGlmIChkaW1DbXAubGVuZ3RoKVxyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbUNtcCksICdEaW1fQ2FtcGFuaWEnKTtcclxuXHJcbiAgLy8gUGFyYW1zICh0aXBvIGRlIGNhbWJpbywgZmVjaGEgZXhwb3J0LCB2ZXJzaW9uKVxyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQoXHJcbiAgICB3YixcclxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChbXHJcbiAgICAgIHsgcGFyYW1ldHJvOiAnZXhjaGFuZ2VfcmF0ZV9hcnNfdXNkJywgdmFsb3I6IEVYQ0hBTkdFX1JBVEUgfSxcclxuICAgICAgeyBwYXJhbWV0cm86ICdmZWNoYV9leHBvcnQnLCB2YWxvcjogdG9kYXlTdHIoKSB9LFxyXG4gICAgICB7IHBhcmFtZXRybzogJ3RvdGFsX2ZpbGFzX2ZhY3QnLCB2YWxvcjogZmFjdFJvd3MubGVuZ3RoIH0sXHJcbiAgICBdKSxcclxuICAgICdQYXJhbWV0cm9zJ1xyXG4gICk7XHJcblxyXG4gIC8vIEZhY3RfVmlzaXRhc1xyXG4gIGNvbnN0IHZpc2l0Um93c0IgPSBidWlsZFZpc2l0Um93cygpO1xyXG4gIGlmICh2aXNpdFJvd3NCLmxlbmd0aClcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3NCKSwgJ0ZhY3RfVmlzaXRhcycpO1xyXG4gIC8vIENvbnRhY3RhZG9zXHJcbiAgY29uc3QgY29udGFjdFJvd3NCID0gYnVpbGRDb250YWN0YWRvc1Jvd3MoKTtcclxuICBpZiAoY29udGFjdFJvd3NCLmxlbmd0aClcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb250YWN0Um93c0IpLCAnQ29udGFjdGFkb3MnKTtcclxuICAvLyBMb2cgZGUgb3BlcmFjaW9uZXNcclxuICBjb25zdCBvcHNSb3dzQiA9IGJ1aWxkT3BzTG9nUm93cygpO1xyXG4gIGlmIChvcHNSb3dzQi5sZW5ndGgpXHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQob3BzUm93c0IpLCAnTG9nX09wZXJhY2lvbmVzJyk7XHJcblxyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19Qb3dlckJJXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG4vLyAtLS0tLS0tLS0tIE9QQ0lPTiBDOiBQeXRob24gLyBJQSAvIE1MIChzaW5nbGUgbG9uZy1mb3JtYXQgdGFibGUpIC0tLS0tLS0tLS1cclxud2luZG93LmV4cG9ydE1MID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcclxuICAvLyBtYXN0ZXJfbWw6IHVuYSBmaWxhIHBvciBsaW5lYSBjb24gVE9EQVMgbGFzIGZlYXR1cmVzXHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XHJcbiAgd3NbJyFjb2xzJ10gPSBPYmplY3Qua2V5cyhyb3dzWzBdIHx8IHsgZmVjaGE6ICcnIH0pLm1hcCgoKSA9PiAoeyB3Y2g6IDE0IH0pKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ21hc3Rlcl9tbCcpO1xyXG5cclxuICAvLyBjYXRhbG9nbyB5IHVuaXZlcnNvIGRlIGNsaWVudGVzIGNvbW8gcmVmZXJlbmNpYXMgcGFyYSBlbnJpcXVlY2VyIGVuIHBhbmRhc1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQoXHJcbiAgICB3YixcclxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChcclxuICAgICAgUFJPRFVDVFMubWFwKChwKSA9PiAoeyBjb2RlOiBwLmNvZGUsIGRlc2M6IHAuZGVzYywgY2F0OiBwLmNhdCwgZmFtOiBwLmZhbSwgc3ViOiBwLnN1YiB9KSlcclxuICAgICksXHJcbiAgICAncHJvZHVjdG9zX2NhdGFsb2dvJ1xyXG4gICk7XHJcblxyXG4gIGNvbnN0IHVuaXZlcnNlID0gW107XHJcbiAgUE9JTlRTLmZvckVhY2goKHApID0+IHtcclxuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3AudmVuZG9yXTtcclxuICAgIHAuY2xpZW50cy5mb3JFYWNoKChuKSA9PiB7XHJcbiAgICAgIHVuaXZlcnNlLnB1c2goe1xyXG4gICAgICAgIGNsaWVudGU6IG4sXHJcbiAgICAgICAgdGlwbzogJ2NsaWVudGVfYWN0dWFsJyxcclxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcclxuICAgICAgICBsb2NhbGlkYWQ6IHAubmFtZSxcclxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcclxuICAgICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHAudmVuZG9yIHx8ICcnKSxcclxuICAgICAgICB6b25hOiB2bSA/IHZtLnpvbmUgOiAnJyxcclxuICAgICAgICBsYXQ6IHAubGF0LFxyXG4gICAgICAgIGxvbjogcC5sb24sXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgICBwLnByb3NwZWN0cy5mb3JFYWNoKChuKSA9PiB7XHJcbiAgICAgIHVuaXZlcnNlLnB1c2goe1xyXG4gICAgICAgIGNsaWVudGU6IG4sXHJcbiAgICAgICAgdGlwbzogJ3Byb3NwZWN0bycsXHJcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXHJcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXHJcbiAgICAgICAgZGVwYXJ0YW1lbnRvOiBwLmRlcHQgfHwgJycsXHJcbiAgICAgICAgdmVuZGVkb3I6IHRpdGxlQ2FzZShwLnZlbmRvciB8fCAnJyksXHJcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXHJcbiAgICAgICAgbGF0OiBwLmxhdCxcclxuICAgICAgICBsb246IHAubG9uLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh1bml2ZXJzZSksICd1bml2ZXJzb19jbGllbnRlcycpO1xyXG5cclxuICAvLyB0YXJnZXRzIGNvbW8gdGFibGEgbG9uZ1xyXG4gIGNvbnN0IHRhcmdldHNMb25nID0gW107XHJcbiAgT2JqZWN0LmVudHJpZXMoVEFSR0VUU19CWV9WRU5ET1IpLmZvckVhY2goKFt2ZW5kb3IsIHRdKSA9PiB7XHJcbiAgICB0YXJnZXRzTG9uZy5wdXNoKHtcclxuICAgICAgdmVuZGVkb3I6IGRpc3BsYXlWZW5kb3JOYW1lKHZlbmRvciksXHJcbiAgICAgIHBlcmlvZG86ICdKdWwgMjAyNicsXHJcbiAgICAgIHN0YXJ0X2RhdGU6ICcyMDI2LTA3LTAxJyxcclxuICAgICAgZW5kX2RhdGU6ICcyMDI2LTA3LTMxJyxcclxuICAgICAgdGFyZ2V0X3VzZDogdC5qdWwyMDI2X3VzZCB8fCAwLFxyXG4gICAgfSk7XHJcbiAgICB0YXJnZXRzTG9uZy5wdXNoKHtcclxuICAgICAgdmVuZGVkb3I6IGRpc3BsYXlWZW5kb3JOYW1lKHZlbmRvciksXHJcbiAgICAgIHBlcmlvZG86ICdKdWwtRGljIDIwMjYnLFxyXG4gICAgICBzdGFydF9kYXRlOiAnMjAyNi0wNy0wMScsXHJcbiAgICAgIGVuZF9kYXRlOiAnMjAyNi0xMi0zMScsXHJcbiAgICAgIHRhcmdldF91c2Q6IHQuanVsRGljMjAyNl91c2QgfHwgMCxcclxuICAgIH0pO1xyXG4gICAgdGFyZ2V0c0xvbmcucHVzaCh7XHJcbiAgICAgIHZlbmRlZG9yOiBkaXNwbGF5VmVuZG9yTmFtZSh2ZW5kb3IpLFxyXG4gICAgICBwZXJpb2RvOiAnMjAyNycsXHJcbiAgICAgIHN0YXJ0X2RhdGU6ICcyMDI3LTAxLTAxJyxcclxuICAgICAgZW5kX2RhdGU6ICcyMDI3LTEyLTMxJyxcclxuICAgICAgdGFyZ2V0X3VzZDogdC5hbnVhbDIwMjdfdXNkIHx8IDAsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodGFyZ2V0c0xvbmcpLCAndGFyZ2V0c19sb25nJyk7XHJcblxyXG4gIC8vIGNhbXBhXHUwMEYxYXNcclxuICBpZiAoY2FtcGFpZ25zQ2FjaGUubGVuZ3RoKSB7XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxyXG4gICAgICB3YixcclxuICAgICAgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFxyXG4gICAgICAgIGNhbXBhaWduc0NhY2hlLm1hcCgoYykgPT4gKHtcclxuICAgICAgICAgIGlkOiBjLmlkLFxyXG4gICAgICAgICAgbm9tYnJlOiBjLm5hbWUsXHJcbiAgICAgICAgICBmaWx0ZXJfdHlwZTogYy5maWx0ZXJUeXBlLFxyXG4gICAgICAgICAgZmlsdGVyX3ZhbHVlczogKGMuZmlsdGVyVmFsdWVzIHx8IFtdKS5qb2luKCcsJyksXHJcbiAgICAgICAgICB0YXJnZXRfdHlwZTogYy50YXJnZXRUeXBlLFxyXG4gICAgICAgICAgdGFyZ2V0X2Ftb3VudDogYy50YXJnZXRBbW91bnQsXHJcbiAgICAgICAgICBzdGFydF9kYXRlOiBjLnN0YXJ0RGF0ZSxcclxuICAgICAgICAgIGVuZF9kYXRlOiBjLmVuZERhdGUsXHJcbiAgICAgICAgfSkpXHJcbiAgICAgICksXHJcbiAgICAgICdjYW1wYW5pYXMnXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgLy8gcGFyYW1ldHJvc1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQoXHJcbiAgICB3YixcclxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChbXHJcbiAgICAgIHsgcGFyYW1ldHJvOiAnZXhjaGFuZ2VfcmF0ZV9hcnNfdXNkJywgdmFsb3I6IEVYQ0hBTkdFX1JBVEUgfSxcclxuICAgICAgeyBwYXJhbWV0cm86ICdmZWNoYV9leHBvcnQnLCB2YWxvcjogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXHJcbiAgICBdKSxcclxuICAgICdwYXJhbWV0cm9zJ1xyXG4gICk7XHJcblxyXG4gIC8vIHZpc2l0YXNcclxuICBjb25zdCB2aXNpdFJvd3NDID0gYnVpbGRWaXNpdFJvd3MoKTtcclxuICBpZiAodmlzaXRSb3dzQy5sZW5ndGgpXHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodmlzaXRSb3dzQyksICd2aXNpdGFzJyk7XHJcbiAgLy8gY29udGFjdGFkb3NcclxuICBjb25zdCBjb250YWN0Um93c0MgPSBidWlsZENvbnRhY3RhZG9zUm93cygpO1xyXG4gIGlmIChjb250YWN0Um93c0MubGVuZ3RoKVxyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnRhY3RSb3dzQyksICdjb250YWN0YWRvcycpO1xyXG4gIC8vIGxvZyBkZSBvcGVyYWNpb25lc1xyXG4gIGNvbnN0IG9wc1Jvd3NDID0gYnVpbGRPcHNMb2dSb3dzKCk7XHJcbiAgaWYgKG9wc1Jvd3NDLmxlbmd0aClcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChvcHNSb3dzQyksICdsb2dfb3BlcmFjaW9uZXMnKTtcclxuXHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX01MXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gdjM3MSs6IEV4cG9ydCBkYXRhc2V0IHBhcmEgYW5cdTAwRTFsaXNpcyAoWklQIGRlIENTVnMgcGFyYSBNTCBwaXBlbGluZXMpXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuLyoqXHJcbiAqIEFicmUgZWwgbW9kYWwgY2hpY28gZGlzcGF0Y2hlciBkZWwgYm90b24gXCJFeHBvcnRhciBhIEV4Y2VsXCIuIE11ZXN0cmFcclxuICogMiB0YXJqZXRhczogUmVwb3J0ZXMgRXhjZWwgKHRvZG9zKSB2cyBEYXRhc2V0IFpJUCAoc29sbyBhZG1pbi9nZXJlbnRlKS5cclxuICovXHJcbndpbmRvdy5vcGVuRXhwb3J0Rm9ybWF0TW9kYWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgLy8gT2N1bHRhci9tb3N0cmFyIHRhcmpldGEgRGF0YXNldCBzZWd1biByb2wuXHJcbiAgY29uc3QgZHNPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1kYXRhc2V0LXppcCcpO1xyXG4gIGlmIChkc09wdCkge1xyXG4gICAgY29uc3QgaXNBZG1pbk9yR2VyZW50ZSA9IHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAnZ2VyZW50ZSc7XHJcbiAgICBkc09wdC5zdHlsZS5kaXNwbGF5ID0gaXNBZG1pbk9yR2VyZW50ZSA/ICcnIDogJ25vbmUnO1xyXG4gIH1cclxuICAvLyBPY3VsdGFyIHByb2dyZXNzIGJhciAocG9yIHNpIHF1ZWRvIGFiaWVydG8gZGUgdW5hIGVqZWN1Y2lvbiBhbnRlcmlvcilcclxuICBjb25zdCBwcm9nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LXByb2dyZXNzJyk7XHJcbiAgaWYgKHByb2cpIHByb2cuc3R5bGUuZGlzcGxheSA9ICdub25lJztcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxufTtcclxuXHJcbndpbmRvdy5jbG9zZUV4cG9ydEZvcm1hdE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZm9ybWF0LW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEFjdHVhbGl6YSBlbCBzdGF0dXMgKyBiYXJyYSBkZWwgbW9kYWwuIHN0YXR1cyBlcyB0ZXh0byBsaWJyZTsgcGVyY2VudCAwLi4xMDAuXHJcbiAqL1xyXG5mdW5jdGlvbiBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3Moc3RhdHVzLCBwZXJjZW50KSB7XHJcbiAgY29uc3QgcyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZGF0YXNldC1zdGF0dXMnKTtcclxuICBjb25zdCBiID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LWJhcicpO1xyXG4gIGNvbnN0IHdyYXAgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWRhdGFzZXQtcHJvZ3Jlc3MnKTtcclxuICBpZiAod3JhcCkgd3JhcC5zdHlsZS5kaXNwbGF5ID0gJyc7XHJcbiAgaWYgKHMpIHMudGV4dENvbnRlbnQgPSBzdGF0dXM7XHJcbiAgaWYgKGIpIGIuc3R5bGUud2lkdGggPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHBlcmNlbnQpKSArICclJztcclxufVxyXG5cclxuLyoqXHJcbiAqIEZldGNoIHN0b2NrLmpzb24gZGVsIHJvb3QgZGVsIHNpdGlvICh2MzY5KyB0aWVuZSB3YXJlaG91c2VCcmVha2Rvd24pLlxyXG4gKiBDYWNoZS1idXN0aW5nIGNvbiA/dD0gcGFyYSBldml0YXIgU1cuXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBfZmV0Y2hTdG9ja0pzb24oKSB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaCgnLi9zdG9jay5qc29uP3Q9JyArIERhdGUubm93KCksIHsgY2FjaGU6ICduby1zdG9yZScgfSk7XHJcbiAgICBpZiAoIXIub2spIHRocm93IG5ldyBFcnJvcignSFRUUCAnICsgci5zdGF0dXMpO1xyXG4gICAgcmV0dXJuIGF3YWl0IHIuanNvbigpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignW2V4cG9ydERhdGFzZXRaaXBdIHN0b2NrLmpzb24gZmFsbG86JywgZSAmJiBlLm1lc3NhZ2UpO1xyXG4gICAgcmV0dXJuIG51bGw7IC8vIG5vIGJsb3F1ZWFudGUgXHUyMDE0IHByb2R1Y3Rvcy5jc3YgcXVlZGEgdmFjaW9cclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBMYXp5IGxvYWQgSlNaaXAgKHBhdHJvbiB5YSB1c2FkbyBlbiBleHBvcnRQaG90b3NaaXAgbGluZWEgfjQ3KS5cclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIF9lbnN1cmVKU1ppcExvYWRlZCgpIHtcclxuICBpZiAodHlwZW9mIEpTWmlwICE9PSAndW5kZWZpbmVkJykgcmV0dXJuO1xyXG4gIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgIGNvbnN0IHMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKTtcclxuICAgIHMuc3JjID0gJ2h0dHBzOi8vY2RuanMuY2xvdWRmbGFyZS5jb20vYWpheC9saWJzL2pzemlwLzMuMTAuMS9qc3ppcC5taW4uanMnO1xyXG4gICAgcy5vbmxvYWQgPSByZXNvbHZlO1xyXG4gICAgcy5vbmVycm9yID0gKCkgPT4gcmVqZWN0KG5ldyBFcnJvcignTm8gc2UgcHVkbyBjYXJnYXIgSlNaaXAnKSk7XHJcbiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHMpO1xyXG4gIH0pO1xyXG59XHJcblxyXG4vKipcclxuICogRGVzY2FyZ2EgdW4gQmxvYiBjb21vIGFyY2hpdm8uIFJldXNhIGVsIHBhdHJvbiBkZSBleHBvcnRQaG90b3NaaXAuXHJcbiAqL1xyXG5mdW5jdGlvbiBfZG93bmxvYWRCbG9iKGJsb2IsIGZpbGVuYW1lKSB7XHJcbiAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gIGEuaHJlZiA9IHVybDtcclxuICBhLmRvd25sb2FkID0gZmlsZW5hbWU7XHJcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcclxuICBhLmNsaWNrKCk7XHJcbiAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xyXG4gICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xyXG4gIH0sIDEwMCk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBFWFBPUlQgUFJJTkNJUEFMLiBTb2xvIGFkbWluL2dlcmVudGUuIEdlbmVyYSBaSVAgY29uOlxyXG4gKiAgLSBwZWRpZG9zLmNzdiwgdmlzaXRhcy5jc3YsIGNsaWVudGVzLmNzdiwgY2xpZW50X21hc3Rlci5jc3YsIHJlbmRpY2lvbmVzLmNzdixcclxuICogICAgY2FtcGFuaWFzLmNzdiwgdGFyZ2V0cy5jc3YsIHByb2R1Y3Rvcy5jc3YsIHZlbmRvcl9vdmVycmlkZXMuY3N2LFxyXG4gKiAgICBjdXN0b21fcm91dGVzLmNzdiwgc2VndWltaWVudG9fbm90ZXMuY3N2XHJcbiAqICAtIG1hbmlmZXN0Lmpzb24gKHNjaGVtYSArIHVzZUNhc2VNYXRyaXggKyByb3dDb3VudHMgKyBudWxsUmF0ZUJ5RmllbGQgKyBsaW1pdGF0aW9ucylcclxuICpcclxuICogQ2Fzb3MgYm9yZGUgbWFuZWphZG9zOlxyXG4gKiAgLSBTaSBhbGd1bmEgLmdldCgpIGZhbGxhIC0+IGFsZXJ0ICsgbm8gZGVzY2FyZ2FyIChubyBnZW5lcmEgWklQIHBhcmNpYWwgc2lsZW5jaW9zbykuXHJcbiAqICAtIFNpIHN0b2NrLmpzb24gbm8gcmVzcG9uZGUgLT4gcHJvZHVjdG9zLmNzdiBxdWVkYSB2YWNpbyBjb24gd2FybmluZyBlbiBtYW5pZmVzdC5cclxuICogIC0gUHJvZ3Jlc3MgYmFyIGVuIGVsIG1vZGFsIHBhcmEgZmVlZGJhY2sgKH4xMC0zMCBzZWcpLlxyXG4gKi9cclxud2luZG93LmV4cG9ydERhdGFzZXRaaXAgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcclxuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZW4gZXhwb3J0YXIgZWwgZGF0YXNldC4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKCFmYkRiKSB7XHJcbiAgICBhbGVydCgnRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkby4gUmVjYXJnYSBsYSBhcHAuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICAvLyBSZS1hYnJpciBtb2RhbCBzaSBlbCB1c3VhcmlvIGNlcnJvIHkgbmF2ZWdhbW9zIHBvciBvdHJvIGZsdWpvLlxyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZm9ybWF0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG4gIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnUHJlcGFyYW5kby4uLicsIDUpO1xyXG5cclxuICB0cnkge1xyXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdDYXJnYW5kbyBKU1ppcC4uLicsIDEwKTtcclxuICAgIGF3YWl0IF9lbnN1cmVKU1ppcExvYWRlZCgpO1xyXG5cclxuICAgIC8vIDEpIEZldGNoIDEzIGNvbGVjY2lvbmVzIEZpcmVzdG9yZSBlbiBwYXJhbGVsbyArIHN0b2NrLmpzb24uXHJcbiAgICAvLyB2NzMyICgyMDI2LTA4LTI5KTogKyBzYXBfc25hcHNob3QsIGZhY3R1cmFjaW9uX3NuYXBzaG90LCBiYWNrb3JkZXJfc25hcHNob3RcclxuICAgIC8vIChhbnRlcyBleGNsdWlkb3M7IGFob3JhIGZ1ZW50ZSBkZSB2ZXJkYWQgZGUgZmFjdHVyYWNpb24gcmVhbCBTQVAgKyBkZW1hbmRcclxuICAgIC8vIHN1cHJlc3Npb24gKyBhZ3JlZ2Fkb3MgZGlhcmlvcyBsaXN0b3MtcGFyYS1iZW5jaG1hcmspLlxyXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdMZXllbmRvIEZpcmVzdG9yZSAoMTMgY29sZWNjaW9uZXMpLi4uJywgMjApO1xyXG4gICAgY29uc3QgZmlyZXN0b3JlRW50cmllcyA9IFtcclxuICAgICAgWydwZWRpZG9zJywgZmJEYi5jb2xsZWN0aW9uKCdwZWRpZG9zJykuZ2V0KCldLFxyXG4gICAgICBbJ3Zpc2l0YXMnLCBmYkRiLmNvbGxlY3Rpb24oJ3Zpc2l0cycpLmdldCgpXSxcclxuICAgICAgWydjbGllbnRlcycsIGZiRGIuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpLmdldCgpXSxcclxuICAgICAgWydjbGllbnRfbWFzdGVyJywgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfbWFzdGVyJykuZ2V0KCldLFxyXG4gICAgICBbJ3JlbmRpY2lvbmVzJywgZmJEYi5jb2xsZWN0aW9uKCdyZW5kaWNpb25lcycpLmdldCgpXSxcclxuICAgICAgWydjYW1wYW5pYXMnLCBmYkRiLmNvbGxlY3Rpb24oJ2NhbXBhaWducycpLmdldCgpXSxcclxuICAgICAgWyd0YXJnZXRzJywgZmJEYi5jb2xsZWN0aW9uKCd0YXJnZXRzJykuZ2V0KCldLFxyXG4gICAgICBbJ3ZlbmRvcl9vdmVycmlkZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ3ZlbmRvcl9vdmVycmlkZXMnKS5nZXQoKV0sXHJcbiAgICAgIFsnY3VzdG9tX3JvdXRlcycsIGZiRGIuY29sbGVjdGlvbignY3VzdG9tX3JvdXRlcycpLmdldCgpXSxcclxuICAgICAgWydzZWd1aW1pZW50b19ub3RlcycsIGZiRGIuY29sbGVjdGlvbignc2VndWltaWVudG9fbm90ZXMnKS5nZXQoKV0sXHJcbiAgICAgIFsnc2FwX3NuYXBzaG90JywgZmJEYi5jb2xsZWN0aW9uKCdzYXBfc25hcHNob3QnKS5nZXQoKV0sXHJcbiAgICAgIFsnZmFjdHVyYWNpb25fc25hcHNob3QnLCBmYkRiLmNvbGxlY3Rpb24oJ2ZhY3R1cmFjaW9uX3NuYXBzaG90JykuZ2V0KCldLFxyXG4gICAgICBbJ2JhY2tvcmRlcl9zbmFwc2hvdCcsIGZiRGIuY29sbGVjdGlvbignYmFja29yZGVyX3NuYXBzaG90JykuZ2V0KCldLFxyXG4gICAgXTtcclxuICAgIGNvbnN0IHByb21pc2VzID0gZmlyZXN0b3JlRW50cmllcy5tYXAoKFssIHBdKSA9PiBwKTtcclxuICAgIHByb21pc2VzLnB1c2goX2ZldGNoU3RvY2tKc29uKCkpO1xyXG5cclxuICAgIGNvbnN0IHNldHRsZWQgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQocHJvbWlzZXMpO1xyXG4gICAgLy8gU2kgQ1VBTFFVSUVSIGdldCgpIGRlIEZpcmVzdG9yZSByZWNoYXpvLCBhYm9ydGFtb3MgKG5vIGV4cG9ydCBwYXJjaWFsIHNpbGVuY2lvc28pLlxyXG4gICAgY29uc3QgZmFpbGVkRmlyZXN0b3JlID0gW107XHJcbiAgICBzZXR0bGVkLnNsaWNlKDAsIGZpcmVzdG9yZUVudHJpZXMubGVuZ3RoKS5mb3JFYWNoKChyLCBpKSA9PiB7XHJcbiAgICAgIGlmIChyLnN0YXR1cyA9PT0gJ3JlamVjdGVkJylcclxuICAgICAgICBmYWlsZWRGaXJlc3RvcmUucHVzaChcclxuICAgICAgICAgIGZpcmVzdG9yZUVudHJpZXNbaV1bMF0gKyAnOiAnICsgKChyLnJlYXNvbiAmJiByLnJlYXNvbi5tZXNzYWdlKSB8fCByLnJlYXNvbilcclxuICAgICAgICApO1xyXG4gICAgfSk7XHJcbiAgICBpZiAoZmFpbGVkRmlyZXN0b3JlLmxlbmd0aCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXHJcbiAgICAgICAgJ0ZpcmVzdG9yZSBmZXRjaCBmYWxsbyBlbiAnICtcclxuICAgICAgICAgIGZhaWxlZEZpcmVzdG9yZS5sZW5ndGggK1xyXG4gICAgICAgICAgJyBjb2xlY2Npb25lczpcXG4nICtcclxuICAgICAgICAgIGZhaWxlZEZpcmVzdG9yZS5qb2luKCdcXG4nKVxyXG4gICAgICApO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIDIpIEV4dHJhZXIgc25hcHNob3RzICsgZG9jcyBjb24gX2lkXHJcbiAgICBjb25zdCBzbmFwc2hvdHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueVtdPn0gKi8gKHt9KTtcclxuICAgIGZpcmVzdG9yZUVudHJpZXMuZm9yRWFjaCgoW25hbWVdLCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHNuYXAgPSAvKiogQHR5cGUge2FueX0gKi8gKHNldHRsZWRbaV0pLnZhbHVlO1xyXG4gICAgICBjb25zdCBkb2NzID0gW107XHJcbiAgICAgIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IGRhdGEgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgICAgICBkYXRhLl9pZCA9IGQuaWQ7XHJcbiAgICAgICAgZG9jcy5wdXNoKGRhdGEpO1xyXG4gICAgICB9KTtcclxuICAgICAgc25hcHNob3RzW25hbWVdID0gZG9jcztcclxuICAgIH0pO1xyXG4gICAgY29uc3Qgc3RvY2tKc29uID0gLyoqIEB0eXBlIHthbnl9ICovIChzZXR0bGVkW3NldHRsZWQubGVuZ3RoIC0gMV0pLnZhbHVlOyAvLyBwdWVkZSBzZXIgbnVsbFxyXG5cclxuICAgIC8vIDMpIENvbnN0cnVpciBDU1ZzIGNvbiByb3cgYnVpbGRlcnMgKyBzY2hlbWFzXHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ1NlcmlhbGl6YW5kbyBDU1ZzLi4uJywgNTUpO1xyXG4gICAgY29uc3QgY3N2cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi8gKHt9KTtcclxuICAgIGNvbnN0IHJvd0NvdW50cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi8gKHt9KTtcclxuICAgIGNvbnN0IGFsbFJvd3NCeUNzdiA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYW55W11bXT59ICovICh7fSk7XHJcblxyXG4gICAgZm9yIChjb25zdCBjb2xsTmFtZSBvZiBPYmplY3Qua2V5cyhzbmFwc2hvdHMpKSB7XHJcbiAgICAgIGNvbnN0IHNjaGVtYSA9IERBVEFTRVRfU0NIRU1BU1tjb2xsTmFtZV07XHJcbiAgICAgIGlmICghc2NoZW1hKSBjb250aW51ZTtcclxuICAgICAgY29uc3QgYnVpbGRlciA9IFJPV19CVUlMREVSU1tjb2xsTmFtZV07XHJcbiAgICAgIGlmICghYnVpbGRlcikgY29udGludWU7XHJcbiAgICAgIGNvbnN0IGFsbFJvd3MgPSAvKiogQHR5cGUge2FueVtdW119ICovIChbXSk7XHJcbiAgICAgIGZvciAoY29uc3QgZG9jIG9mIHNuYXBzaG90c1tjb2xsTmFtZV0pIHtcclxuICAgICAgICBjb25zdCByb3dzRm9yRG9jID0gYnVpbGRlcihkb2MpO1xyXG4gICAgICAgIGZvciAoY29uc3QgciBvZiByb3dzRm9yRG9jKSBhbGxSb3dzLnB1c2gocik7XHJcbiAgICAgIH1cclxuICAgICAgYWxsUm93c0J5Q3N2W3NjaGVtYS5uYW1lXSA9IGFsbFJvd3M7XHJcbiAgICAgIGNzdnNbc2NoZW1hLm5hbWVdID0gYnVpbGRDc3Yoc2NoZW1hLCBhbGxSb3dzKTtcclxuICAgICAgcm93Q291bnRzW3NjaGVtYS5uYW1lXSA9IGFsbFJvd3MubGVuZ3RoO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIHByb2R1Y3Rvcy5jc3YgKGRlc2RlIHN0b2NrLmpzb24sIG5vIEZpcmVzdG9yZSlcclxuICAgIGNvbnN0IHByb2R1Y3Rvc1NjaGVtYSA9IERBVEFTRVRfU0NIRU1BUy5wcm9kdWN0b3M7XHJcbiAgICBjb25zdCBwcm9kdWN0b3NSb3dzID0gc3RvY2tKc29uID8gYnVpbGRQcm9kdWN0b1Jvd3NGcm9tU3RvY2tKc29uKHN0b2NrSnNvbikgOiBbXTtcclxuICAgIGFsbFJvd3NCeUNzdltwcm9kdWN0b3NTY2hlbWEubmFtZV0gPSBwcm9kdWN0b3NSb3dzO1xyXG4gICAgY3N2c1twcm9kdWN0b3NTY2hlbWEubmFtZV0gPSBidWlsZENzdihwcm9kdWN0b3NTY2hlbWEsIHByb2R1Y3Rvc1Jvd3MpO1xyXG4gICAgcm93Q291bnRzW3Byb2R1Y3Rvc1NjaGVtYS5uYW1lXSA9IHByb2R1Y3Rvc1Jvd3MubGVuZ3RoO1xyXG5cclxuICAgIC8vIDQpIENvbXB1dGFyIG51bGxSYXRlQnlGaWVsZCBwYXJhIGNhZGEgY2FzbyBBLUVcclxuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnQ2FsY3VsYW5kbyBjYWxpZGFkIGRlbCBkYXRhc2V0Li4uJywgNzUpO1xyXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBhbnk+fSAqL1xyXG4gICAgY29uc3QgdXNlQ2FzZVdpdGhTdGF0cyA9IHt9O1xyXG4gICAgZm9yIChjb25zdCBbY2FzZUtleSwgdWNdIG9mIE9iamVjdC5lbnRyaWVzKERBVEFTRVRfVVNFX0NBU0VfTUFUUklYKSkge1xyXG4gICAgICBjb25zdCBzdGF0cyA9IC8qKiBAdHlwZSB7YW55fSAqLyAoe1xyXG4gICAgICAgIHByaW9yaXR5OiB1Yy5wcmlvcml0eSxcclxuICAgICAgICBkZXNjcmlwdGlvbjogdWMuZGVzY3JpcHRpb24sXHJcbiAgICAgICAgcmVxdWlyZWRGaWVsZHM6IHVjLnJlcXVpcmVkRmllbGRzLFxyXG4gICAgICAgIGpvaW5Ob3RlczogdWMuam9pbk5vdGVzLFxyXG4gICAgICAgIG51bGxSYXRlQnlGaWVsZDoge30sXHJcbiAgICAgICAgbGltaXRhdGlvbnM6IFtdLFxyXG4gICAgICB9KTtcclxuICAgICAgbGV0IGhhc0hpZ2hOdWxsUmF0ZSA9IGZhbHNlO1xyXG4gICAgICBsZXQgaGFzRW1wdHlSZXF1aXJlZCA9IGZhbHNlO1xyXG4gICAgICBmb3IgKGNvbnN0IFtjc3ZOYW1lLCBmaWVsZHNdIG9mIE9iamVjdC5lbnRyaWVzKHVjLnJlcXVpcmVkRmllbGRzKSkge1xyXG4gICAgICAgIGNvbnN0IHNjaGVtYUZvckNzdiA9IE9iamVjdC52YWx1ZXMoREFUQVNFVF9TQ0hFTUFTKS5maW5kKChzKSA9PiBzLm5hbWUgPT09IGNzdk5hbWUpO1xyXG4gICAgICAgIGlmICghc2NoZW1hRm9yQ3N2KSB7XHJcbiAgICAgICAgICBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKCdTY2hlbWEgbm8gZW5jb250cmFkbyBwYXJhICcgKyBjc3ZOYW1lKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCByb3dzID0gYWxsUm93c0J5Q3N2W2Nzdk5hbWVdIHx8IFtdO1xyXG4gICAgICAgIGNvbnN0IHJhdGVzID0gY29tcHV0ZU51bGxSYXRlcyhzY2hlbWFGb3JDc3YsIHJvd3MsIGZpZWxkcyk7XHJcbiAgICAgICAgZm9yIChjb25zdCBbZiwgcmF0ZV0gb2YgT2JqZWN0LmVudHJpZXMocmF0ZXMpKSB7XHJcbiAgICAgICAgICBzdGF0cy5udWxsUmF0ZUJ5RmllbGRbY3N2TmFtZSArICcuJyArIGZdID0gcmF0ZTtcclxuICAgICAgICAgIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkgaGFzRW1wdHlSZXF1aXJlZCA9IHRydWU7XHJcbiAgICAgICAgICBlbHNlIGlmIChyYXRlID4gMC41KSBoYXNIaWdoTnVsbFJhdGUgPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBpZiAoaGFzRW1wdHlSZXF1aXJlZCkge1xyXG4gICAgICAgIHN0YXRzLnN0YXR1cyA9ICdFTVBUWSc7XHJcbiAgICAgICAgc3RhdHMubGltaXRhdGlvbnMucHVzaChcclxuICAgICAgICAgICdBbGd1bmEgY29sZWNjaW9uIHJlcXVlcmlkYSBlc3RhIHZhY2lhIFx1MjAxNCBlbCBjYXNvIG5vIHNlIHB1ZWRlIGVudHJlbmFyIGhveSBwZXJvIGVsIHNjaGVtYSBlc3RhIGxpc3RvLidcclxuICAgICAgICApO1xyXG4gICAgICB9IGVsc2UgaWYgKGhhc0hpZ2hOdWxsUmF0ZSkge1xyXG4gICAgICAgIHN0YXRzLnN0YXR1cyA9ICdQQVJUSUFMJztcclxuICAgICAgICBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKFxyXG4gICAgICAgICAgJ0FsIG1lbm9zIDEgY2FtcG8gcmVxdWVyaWRvIHRpZW5lID41MCUgZGUgbnVsbHMgXHUyMDE0IHJldmlzYXIgdGFzYXMgYW50ZXMgZGUgdXNhci4nXHJcbiAgICAgICAgKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBzdGF0cy5zdGF0dXMgPSAnT0snO1xyXG4gICAgICB9XHJcbiAgICAgIHVzZUNhc2VXaXRoU3RhdHNbY2FzZUtleV0gPSBzdGF0cztcclxuICAgIH1cclxuXHJcbiAgICAvLyA1KSBNYW5pZmVzdC5qc29uXHJcbiAgICBjb25zdCBleHBvcnRlZEF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG4gICAgY29uc3QgbWFuaWZlc3QgPSB7XHJcbiAgICAgIGV4cG9ydGVkQXQsXHJcbiAgICAgIGFwcFZlcnNpb246IHR5cGVvZiBBUFBfVkVSU0lPTiAhPT0gJ3VuZGVmaW5lZCcgPyBBUFBfVkVSU0lPTiA6ICd1bmtub3duJyxcclxuICAgICAgc291cmNlUHJvamVjdDogJ2FwcC12ZW5kZWRvcmVzLXNoaW1hbm8nLFxyXG4gICAgICBleHBvcnRlZEJ5RW1haWw6IChjdXJyZW50VXNlciAmJiBjdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nLFxyXG4gICAgICBleHBvcnRlZEJ5VWlkOiAoY3VycmVudFVzZXIgJiYgY3VycmVudFVzZXIudWlkKSB8fCAndW5rbm93bicsXHJcbiAgICAgIGNzdkNvbnZlbnRpb25zOiB7XHJcbiAgICAgICAgZW5jb2Rpbmc6ICdVVEYtOCcsXHJcbiAgICAgICAgc2VwYXJhdG9yOiAnLCcsXHJcbiAgICAgICAgcXVvdGVDaGFyOiAnXCInLFxyXG4gICAgICAgIGVzY2FwZVF1b3RlOiAnXCJcIicsXHJcbiAgICAgICAgbGluZVRlcm1pbmF0b3I6ICdcXFxcclxcXFxuJyxcclxuICAgICAgICBkYXRlRm9ybWF0OiAnSVNPIDg2MDEgVVRDICh3aXRoIFopJyxcclxuICAgICAgICBkZWNpbWFsU2VwYXJhdG9yOiAnLicsXHJcbiAgICAgICAgbnVsbFJlcHJlc2VudGF0aW9uOiAnKGVtcHR5IGZpZWxkKScsXHJcbiAgICAgICAgYXJyYXlGb3JtYXQ6ICdKU09OIHN0cmluZ2lmaWVkJyxcclxuICAgICAgICBvYmplY3RGb3JtYXQ6ICdKU09OIHN0cmluZ2lmaWVkJyxcclxuICAgICAgfSxcclxuICAgICAgcm93Q291bnRzLFxyXG4gICAgICBzY2hlbWE6IHt9LFxyXG4gICAgICB1c2VDYXNlTWF0cml4OiB1c2VDYXNlV2l0aFN0YXRzLFxyXG4gICAgICBleGNsdXNpb25zOiB7XHJcbiAgICAgICAgbm90ZTogJ0RhdG9zIHNlbnNpYmxlcyB5IGJpbmFyaW9zIGV4Y2x1aWRvcyBkZWwgZXhwb3J0LicsXHJcbiAgICAgICAgLy8gdjczMiAoMjAyNi0wOC0yOSk6IHNhcF9zbmFwc2hvdCB5YSBOTyBzZSBleGNsdXllIChhZ3JlZ2FkbyBjb21vIGZ1ZW50ZVxyXG4gICAgICAgIC8vIGRlIHZlcmRhZCBkZSBmYWN0dXJhY2lvbiByZWFsKS4gZmFjdHVyYWNpb25fc25hcHNob3QgeSBiYWNrb3JkZXJfc25hcHNob3RcclxuICAgICAgICAvLyB0YW1wb2NvIGVyYW4gcGFydGUgZGUgZXN0YSBsaXN0YSBwZXJvIGFob3JhIHNvbiBpbmNsdWlkYXMgZXhwbGljaXRhbWVudGUuXHJcbiAgICAgICAgZXhjbHVkZWRDb2xsZWN0aW9uczogWydyb2xlcycsICdhcHBfY29uZmlnJywgJ25vdGlmaWNhdGlvbnMnLCAnb3BlcmF0aW9uc19sb2cnXSxcclxuICAgICAgICBleGNsdWRlZEZpZWxkczogW1xyXG4gICAgICAgICAgJ3Zpc2l0cy5mcmVudGVMb2NhbCAoZm90b3MgYmFzZTY0KScsXHJcbiAgICAgICAgICAndmlzaXRzLmVzcGFjaW9bXSAoZm90b3MgYmFzZTY0KScsXHJcbiAgICAgICAgICAnY2xpZW50X2FwcGxpY2F0aW9ucy5jb25zdGFuY2lhQXJjYSAoYmFzZTY0KScsXHJcbiAgICAgICAgICAnY2xpZW50X2FwcGxpY2F0aW9ucy5jb25zdGFuY2lhSUlCQiAoYmFzZTY0KScsXHJcbiAgICAgICAgICAnY2xpZW50X2FwcGxpY2F0aW9ucy5mb3Rvc0xvY2FsW10gKGJhc2U2NCknLFxyXG4gICAgICAgICAgJ3JlbmRpY2lvbmVzLmZvdG9UaWNrZXQgKGJhc2U2NCBsZWdhY3kgcHJlLXYzMDg7IHNlIGV4cG9ydGEgc29sbyBmb3RvVGlja2V0VXJsKScsXHJcbiAgICAgICAgXSxcclxuICAgICAgICBzdG9ja0pzb25Mb2FkZWQ6IHN0b2NrSnNvbiAhPT0gbnVsbCxcclxuICAgICAgfSxcclxuICAgIH07XHJcbiAgICBmb3IgKGNvbnN0IFtfY29sbE5hbWUsIHNjaGVtYV0gb2YgT2JqZWN0LmVudHJpZXMoREFUQVNFVF9TQ0hFTUFTKSkge1xyXG4gICAgICBtYW5pZmVzdC5zY2hlbWFbc2NoZW1hLm5hbWVdID0gc2NoZW1hLmNvbHVtbnMubWFwKChjKSA9PiAoe1xyXG4gICAgICAgIGNvbDogYy5jb2wsXHJcbiAgICAgICAgdHlwZTogYy50eXBlLFxyXG4gICAgICAgIGRlc2M6IGMuZGVzYyxcclxuICAgICAgfSkpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIDYpIEVtcGFxdWV0YXIgWklQXHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0VtcGFxdWV0YW5kbyBaSVAuLi4nLCA5MCk7XHJcbiAgICBjb25zdCB6aXAgPSBuZXcgSlNaaXAoKTtcclxuICAgIGZvciAoY29uc3QgW25hbWUsIGNvbnRlbnRdIG9mIE9iamVjdC5lbnRyaWVzKGNzdnMpKSB7XHJcbiAgICAgIHppcC5maWxlKG5hbWUsIGNvbnRlbnQpO1xyXG4gICAgfVxyXG4gICAgemlwLmZpbGUoJ21hbmlmZXN0Lmpzb24nLCBKU09OLnN0cmluZ2lmeShtYW5pZmVzdCwgbnVsbCwgMikpO1xyXG5cclxuICAgIGNvbnN0IGJsb2IgPSBhd2FpdCB6aXAuZ2VuZXJhdGVBc3luYyh7XHJcbiAgICAgIHR5cGU6ICdibG9iJyxcclxuICAgICAgY29tcHJlc3Npb246ICdERUZMQVRFJyxcclxuICAgICAgY29tcHJlc3Npb25PcHRpb25zOiB7IGxldmVsOiA2IH0sXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IGZpbGVuYW1lID0gJ3NoaW1hbm8tZGF0YXNldC0nICsgZXhwb3J0ZWRBdC5yZXBsYWNlKC9bOi5dL2csICctJykgKyAnLnppcCc7XHJcbiAgICBfZG93bmxvYWRCbG9iKGJsb2IsIGZpbGVuYW1lKTtcclxuXHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoXHJcbiAgICAgICdEYXRhc2V0IGRlc2NhcmdhZG86ICcgK1xyXG4gICAgICAgIGZpbGVuYW1lICtcclxuICAgICAgICAnICgnICtcclxuICAgICAgICBPYmplY3Qua2V5cyhjc3ZzKS5sZW5ndGggK1xyXG4gICAgICAgICcgQ1NWcyArIG1hbmlmZXN0Lmpzb24pJyxcclxuICAgICAgMTAwXHJcbiAgICApO1xyXG4gICAgaWYgKHR5cGVvZiBzaG93U3luY1RhZyA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICBjb25zdCB0b3RhbFJvd3MgPSBPYmplY3QudmFsdWVzKHJvd0NvdW50cykucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCk7XHJcbiAgICAgIHNob3dTeW5jVGFnKFxyXG4gICAgICAgICdEYXRhc2V0IGV4cG9ydGFkbzogJyArIHRvdGFsUm93cyArICcgZmlsYXMgZW4gJyArIE9iamVjdC5rZXlzKGNzdnMpLmxlbmd0aCArICcgQ1NWcydcclxuICAgICAgKTtcclxuICAgIH1cclxuICAgIHNldFRpbWVvdXQoKCkgPT4gd2luZG93LmNsb3NlRXhwb3J0Rm9ybWF0TW9kYWwoKSwgMzAwMCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW2V4cG9ydERhdGFzZXRaaXBdIGZhdGFsOicsIGUpO1xyXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdFcnJvcjogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpLCAwKTtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnRXJyb3IgYWwgZXhwb3J0YXIgZWwgZGF0YXNldDpcXG5cXG4nICtcclxuICAgICAgICAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSArXHJcbiAgICAgICAgJ1xcblxcbkVsIFpJUCBOTyBzZSBkZXNjYXJnbyAoZXZpdGFtb3MgZ2VuZXJhciB1biBhcmNoaXZvIHBhcmNpYWwpLiBSZXZpc2EgbGEgY29uc29sYSBwYXJhIG1hcyBkZXRhbGxlcy4nXHJcbiAgICApO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PSBFeHBvcnRzIGEgd2luZG93ID09PVxyXG4vLyBUb2RhcyBsYXMgZnVuY2lvbmVzIHdpbmRvdy5mb28gPSBmdW5jdGlvbi4uLiB5YSBlc3RcdTAwRTFuIHZlcmJhdGltLlxyXG5pZiAodHlwZW9mIHdpbmRvdy50b2RheVN0ciA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy50b2RheVN0ciA9IHRvZGF5U3RyO1xyXG4vLyBFNiBob3RmaXggMjogZGF0YVVybFRvQmxvYiArIHNhbml0aXplRm9yUGF0aCB1c2Fkb3MgcG9yIGlubGluZSBydW5GdWxsQmFja3VwIChMNzI3OC03Mjg4KS5cclxuaWYgKHR5cGVvZiB3aW5kb3cuZGF0YVVybFRvQmxvYiA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy5kYXRhVXJsVG9CbG9iID0gZGF0YVVybFRvQmxvYjtcclxuaWYgKHR5cGVvZiB3aW5kb3cuc2FuaXRpemVGb3JQYXRoID09PSAndW5kZWZpbmVkJykgd2luZG93LnNhbml0aXplRm9yUGF0aCA9IHNhbml0aXplRm9yUGF0aDtcclxuLy8gRTYgaG90Zml4IDM6IGNyb3NzLW1vZHVsZSBidWcgKGF1ZGl0IGNyb3NzYnVuZGxlKSBcdTIwMTQgZXhwb3J0cy1jb3JlIGxsYW1hIGxvYWRFeGNlbEpTLlxyXG53aW5kb3cubG9hZEV4Y2VsSlMgPSBsb2FkRXhjZWxKUztcclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBb0NPLFdBQVMsVUFBVSxHQUFHO0FBQzNCLFFBQUksTUFBTSxRQUFRLE1BQU0sT0FBVyxRQUFPO0FBQzFDLFVBQU0sTUFBTSxPQUFPLENBQUM7QUFDcEIsUUFBSSxRQUFRLEdBQUksUUFBTztBQUV2QixRQUFJLFdBQVcsS0FBSyxHQUFHLEdB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
