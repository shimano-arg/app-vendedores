// @ts-check
/**
 * Typedefs compartidos para los docs Firestore + entidades de negocio.
 * Se referencian desde los otros módulos vía `import('./types.js').Pedido`
 * o `@typedef {import('./types.js').X}`.
 *
 * Fase 0 (E3): cobertura mínima de los tipos usados por src/pure/*.js.
 * Cuando E2 modularice el resto, se extienden.
 */

/**
 * Rol de usuario en el sistema (colección /roles).
 * @typedef {'admin' | 'gerente' | 'vendedor' | 'interno' | 'viewer' | 'unassigned'} UserRole
 */

/**
 * Categoría comercial del cliente (impacta descuentos).
 * @typedef {'P' | 'A' | 'B' | 'C' | ''} ClientTipo
 */

/**
 * Cliente Firestore (client_applications / SAP habilitado o provisorio).
 * @typedef {Object} ClientDoc
 * @property {string} [_fsId] ID doc de Firestore.
 * @property {string} [comercio] Nombre comercial (fantasía).
 * @property {string} [fantasia] Alias comercial (v300+).
 * @property {string} [titular] Razón social / titular.
 * @property {string} [cuit] CUIT del cliente.
 * @property {string} [provincia] Provincia AR (24 canónicas + CABA).
 * @property {string} [localidad] Localidad original de SAP.
 * @property {string} [localidadFinal] Localidad final (edit manual override).
 * @property {string | null} [cardCodeSap] CardCode SAP (null/undefined si provisorio).
 * @property {boolean} [manualSapPending] True si Alta Rápida pendiente de SAP.
 * @property {ClientTipo} [cliTipo] Categoría comercial P/A/B/C.
 * @property {string} [ownerUid] UID del vendedor asignado (owner).
 * @property {string} [assignedVendor] displayName del vendor asignado.
 * @property {string} [status] 'pending_approval' | 'approved' | 'rejected'.
 * @property {boolean} [submittedByPublicForm] True si vino del formulario público alta-cliente.html.
 */

/**
 * Pedido Firestore (colección /pedidos).
 * @typedef {Object} PedidoDoc
 * @property {string} [_fsId]
 * @property {string} ownerUid
 * @property {string} [createdByUid] UID del que lo creó (distinto de owner si on-behalf-of).
 * @property {boolean} [onBehalfOf] True si un interno lo creó en nombre de su VDE.
 * @property {'draft' | 'confirmed' | 'sap_imported'} [stage]
 * @property {string} [condicionPago] 'CONTADO' | 'CTA CTE'.
 * @property {number} [discountPct]
 * @property {{ total: number }} [discountSnapshot]
 * @property {Record<string, unknown>[]} [lines] Líneas del pedido.
 */

/**
 * Producto (catálogo product_catalog chunked).
 * @typedef {Object} ProductoDoc
 * @property {string} sku
 * @property {string} name
 * @property {string} [cat]
 * @property {string} [fam]
 * @property {string} [sub]
 */

/**
 * Índice de match SKU → array de productos (construido de PRODUCTS).
 * @typedef {Record<string, ProductoDoc[]>} SkuIndex
 * @typedef {Record<string, ProductoDoc[]>} SkuTokens
 */

export {};
