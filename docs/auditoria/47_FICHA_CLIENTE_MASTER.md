# 47 — APP-04: inventario de datos del cliente para la ficha desplegable del Master de Clientes (2026-11-02)

Etapa 1 de APP-04. Solo lectura: no se modificó código ni se consultó producción. Cada dato tiene su archivo:línea de escritura o lectura. Lo que no figura acá no existe en la app.

## 1. Cómo se identifica un cliente en el Master

`getAllStoreEntries()` (`src/domains/master-clientes.js:183-262`) arma las filas en memoria. Hay 3 tipos:

| Tipo de fila | Origen | Clave del cliente |
|---|---|---|
| `cliente` (vista por defecto) | `POINTS[].clients[]` (padrón inline `index.html:7681`), solo los confirmados en SAP | slug `clientLocId(prov, loc, tienda)` = id del doc en `client_master` |
| `prospecto` (botón Masterfile-Base) | `POINTS[].prospects[]` | mismo slug |
| `sap_alta` | `approvedAltasList` (= `client_applications` aprobadas/sincronizadas de SAP) que no matchean un POINT | `fsId` del doc en `client_applications` + `cardCodeSap` |

No hay una clave única: según el tipo, el cliente es un slug de nombre+lugar o un id de `client_applications`. El CardCode SAP se resuelve con `client_applications.cardCodeSap`, `client_master.sapCardCode` o `sapGetClienteCode(nombre)`.

El Master de Clientes ya está limitado a admin y gerente (`master-clientes.js:265`). Esos roles pueden leer todas las colecciones de abajo.

## 2. Colecciones y fuentes

| Fuente | Id del doc | ¿Ya está en memoria al abrir el Master? |
|---|---|---|
| `POINTS` (inline) | — | Sí |
| `client_master` | slug | **Sí**: listener completo → `window.clientMasterCache` (`master-clientes.js:155-158`) |
| `client_applications` | auto-id | **Sí**: `approvedAltasList` (`index.html:8493-8537`) |
| `vendor_overrides` | `SHOP\|prov\|loc\|tienda` / `LOC\|…` / `PROV\|…` | Sí (vía `getEffectiveVendorForClient`) |
| `client_locations` | slug | No: 1 lectura por cliente |
| `client_buyer_stats` | **cardCode** | No: 1 lectura por cliente con CardCode |
| `cartera_vendor` | vendorKey (array de clientes) | No: 1 lectura por vendedor |
| `userData/{uid}.clientMeta` | uid del usuario que cargó | Solo el del propio usuario; el de cada vendedor queda en su usuario |
| BigQuery `sap_bp_raw` | card_code | No: la app no lo lee desde el navegador |

## 3. Inventario de campos

Abreviaturas: **CA** = `client_applications`, **CM** = `client_master`, **CMeta** = `userData.clientMeta`.

### A. Identificación

| Campo | Fuente | Disponible | Observaciones |
|---|---|---|---|
| Nombre comercial | POINTS (string) / CA.`fantasia` / CA.`comercio` | Siempre | `fantasia` puede ser editado a mano y el sync de SAP no lo pisa (`sync-bp-pesca-core.js:597-614`) |
| Razón social | CA.`comercio` (= CardName de SAP) / CM.`clientName` | Altas SAP; en POINTS solo si se importó SAP | |
| Código SAP | CA.`cardCodeSap` > CM.`sapCardCode` > `sap_clients.sapCode` (por nombre) | Clientes SAP | Los tres son el mismo dato en lugares distintos; CA viene del sync |
| CUIT | CA.`cuit` | Altas y sync SAP | No existe para clientes solo de POINTS sin alta |
| Condición fiscal | CA.`condicionFiscal` | Solo altas por formulario | |
| Tipo SAP / estado SAP | CA.`sapCardType`, `sapValid`, `sapFrozen`, `sapDivision`, `sapUpdateDate` | Sync SAP | |
| Tipo de cliente (P/A/B/C) | CM.`cliTipo` (CA.`cliTipo` en filas sap) | Si se clasificó en la Ficha | **Duplicado**: el descuento lee solo CM |

### B. Comercial

| Campo | Fuente | Disponible | Observaciones |
|---|---|---|---|
| Vendedor asignado | POINTS + `vendor_overrides` (`getEffectiveVendorForClient`) / CA.`assignedVendor` | Siempre (puede estar vacío) | Mismo cálculo que la columna Vendedor |
| Vendedor según SAP | CA.`sapSalesPersonCode` | Sync SAP | Código numérico |
| Zona | POINTS.`vendor` de la localidad | Siempre | |
| Clasificación: fidelidad, preferencia de contacto, tamaño, especialización, tipo de local | CM (Ficha, `index.html:6028-6075`) | Si se cargó la Ficha | Etiquetas en `src/pure/ficha-cliente-labels.js` |
| Crédito en cheques | CM.`creditoCheque` | Si se cargó | Hoy solo visible para admin/gerente/editor de ficha |
| Última visita (fidelidad, tamaños, canal, tipo de venta, fecha, quién) | CM.`lastVisit` (CF `denorm-visit-to-client-master-core.js`) | Si hubo visita | |
| Precaución + motivo | CA.`precaucion`/`precaucionReason` (sap) / CMeta (POINTS) | Si se marcó | Lo de CMeta es por usuario |
| Estado del lead / del alta | CA.`leadEstado`, `status`, `approvals`, `approvedAt`, `source` | Altas | |
| Fecha de alta | CA.`createdAt` | Altas | No existe para clientes solo de POINTS |
| Tipo de comercio, tienda online, web, redes | CA | Solo altas por formulario | |
| Ventas: facturado, cantidad de facturas, primera/última compra, frecuencia, top SKUs/categorías (3/6/12/24 meses) | `client_buyer_stats/{cardCode}` (CF nocturna desde BigQuery) | Clientes con CardCode y facturas | |
| Deuda abierta, facturado 12M, días sin compra/visita/contacto | `cartera_vendor/{vendorKey}` | Clientes de la cartera del vendedor | Única fuente de deuda en Firestore |
| Condición de pago, lista de precios, límite de crédito, saldo | Solo BigQuery `sap_bp_raw` | **No disponible en la app** | El sync de BPs no los guarda en Firestore |
| Observaciones comerciales | — | **No existe** | Lo único parecido es `precaucionReason` |

### C. Ubicación

| Campo | Fuente | Disponible | Observaciones |
|---|---|---|---|
| País | — | **No existe** | Implícito por el dominio (.ar / .uy) |
| Provincia, localidad | POINTS / CA.`provincia`, `localidadFinal`‖`localidad` / CM.`sapState`, `sapCity` | Siempre | CA tiene marca de edición manual (`provinciaLocSource`) |
| Código postal | CA.`codigoPostal` (SAP) ‖ CA.`cp` (formulario) / CM.`sapZip` | Parcial | Dos campos para lo mismo en CA |
| Dirección exacta | CM.`address` (POINTS) / CA.`calle` + `numero` (sap) / CMeta.`address` | Parcial | Es la misma que muestra hoy la columna "Dirección exacta" |
| Dirección SAP importada | CM.`sapAddress`, `sapCity`, `sapState`, `sapZip` | Si se importó SAP | |
| Coordenadas | `client_locations` (GPS de la primera visita) > CA.`lat`/`lng` (geocoding) > CMeta > POINTS (centro de la localidad) | Parcial | |
| Direcciones adicionales (ship-to) | — | **No existe** | SAP las tiene, pero el sync no las guarda |

### D. Contacto

| Campo | Fuente | Disponible | Observaciones |
|---|---|---|---|
| Email | CA.`email` (formulario o SAP) | Parcial | |
| Teléfono | CA.`telefono` (formulario), CA.`telefonoContacto` (SAP Phone1/Cellular o alta rápida) | Parcial | Superpuestos: se muestran los dos con etiqueta |
| Contacto: nombre, teléfono particular, WhatsApp, email | CA.`contactoNombre`, `contactoTelParticular`, `contactoWhatsapp`, `contactoEmail` | Solo altas por formulario | |
| Dueño | CA.`duenoNombre` | Alta rápida | |
| Contactos adicionales | — | **No existe** | Hay un solo contacto por cliente |

### E. Logística y entrega

| Campo | Fuente | Disponible | Observaciones |
|---|---|---|---|
| Modalidad (transportista / envío a sucursal / retiro en depósito) | CM.`defaultDelivery.tipo` | Si el cliente tuvo pedido o lista de espera desde v1100+ | **Último uso gana**: se actualiza solo con cada pedido |
| Transportista y su dirección | CM.`defaultDelivery.transpNombre`, `transpDireccion` | Idem | |
| Domicilio de entrega del cliente | CM.`defaultDelivery.clienteDireccion` | Idem | |
| Dirección de sucursal | CM.`defaultDelivery.sucursalDireccion` | Idem | |
| Quién retira (nombre, apellido, DNI, patente) | CM.`defaultDelivery.retiro*` | Idem | |
| Fecha y usuario del último cambio | CM.`defaultDelivery.updatedAt`, `updatedBy` | Idem | |
| Entrega por pedido | `pedidos.formaEntrega` (misma forma) | Por pedido | Con `defaultDelivery` alcanza para la ficha |
| Localidad/provincia/CP de entrega, horarios, referencias, observaciones logísticas | — | **No existen** | La dirección de entrega es un texto libre |

Limitación: `defaultDelivery` vive en el doc `client_master/{slug}`. Para las filas `sap_alta` el slug se arma con `prov/loc/comercio` del alta. Si el nombre del alta no coincide con el del pedido, no se encuentra (comentario en `master-clientes.js:2388`).

### F. Otros

| Campo | Fuente | Observaciones |
|---|---|---|
| Fusión automática lead → BP | CA.`mergedFromCardCode`, `mergedAt`, `mergedBy` | |
| Alta por formulario público | CA.`submittedByPublicForm` | |
| Constancias ARCA/IIBB, fotos del local | CA.`constanciaArca`, `constanciaIIBB`, `fotosLocal[]` (base64) | Pesadas: en la ficha solo se indica si existen |

## 4. Resumen

- **Completo siempre**: nombre, localidad, provincia, vendedor.
- **Completo para clientes SAP**: código SAP, razón social, CUIT, estado SAP, email/teléfono si están en SAP.
- **Incompleto según el cliente**: dirección exacta, CP, coordenadas, clasificación, entrega, ventas, deuda.
- **En varios lugares**: código SAP, dirección, coordenadas, CP, vendedor, tipo de cliente, teléfono, precaución, nombre. Fuente elegida en la tabla de arriba.
- **No existe en la app**: país, direcciones ship-to, contactos adicionales, horarios, observaciones comerciales/logísticas, condición de pago, lista de precios por cliente, límite de crédito.
- **Requiere relacionar documentos**: entrega y clasificación (CM por slug), ventas (`client_buyer_stats` por CardCode), deuda (`cartera_vendor` por vendedor), GPS (`client_locations` por slug).

## 5. Riesgos encontrados (no se corrigen en APP-04)

1. Un cliente `sap_alta` queda repartido en dos documentos (CA y CM por slug); si cambia nombre/provincia/localidad, el slug cambia.
2. `_buyerEnrichLocationFromClientMaster` (`functions/index.js:~3390`) busca `client_master.doc(cardCode)`, pero los ids son slugs: casi nunca encuentra.
3. `_saveDefaultDeliveryFromWaitlist` (`index.html:~23083`) referencia `cardCode` sin definir en su `.catch`.
4. `cliTipo` puede quedar distinto entre CA y CM para filas sap.

---

# Etapa 3 — Informe final de la implementación (v1539)

## Diseño de la ficha

- En las filas del padrón, el nombre del cliente es el disparador (▶/▼). En las filas provisorias, donde el nombre es un campo editable, hay un botón chico "▶ Ficha" debajo del nombre.
- Al tocar, se inserta una fila debajo con la ficha. Al tocar de nuevo, se cierra. Se pueden abrir varias a la vez, igual que en Stock Asignado.
- Las fichas abiertas siguen abiertas cuando la tabla se vuelve a dibujar (buscador o filtros), si el cliente sigue en la lista.
- Bloques en tarjetas (en grilla, que en celular pasa a una columna): Identificación, Información comercial, Ubicación, Contacto, Logística y envíos, e Información adicional (este último solo si hay datos).
- Los campos importantes sin dato dicen «Sin información registrada» en gris itálica. Los secundarios sin dato no se muestran. Los datos que todavía se están pidiendo dicen «Cargando…».

## Cómo se recupera la información

1. **De memoria, al instante, sin lecturas**:
   - `POINTS`, `approvedAltasList`, `clientMasterCache` (listener que ya abre el Master) y `clientMeta` del usuario;
   - el vendedor, con la misma etiqueta de la columna.
2. **Lecturas puntuales al abrir**, cada una una sola vez por sesión (caché `_mcFichaReadCache` + promesa en curso `_mcFichaInflight`, así que abrir y cerrar no repite):
   - `client_locations/{slug}`: GPS de la visita;
   - `client_buyer_stats/{cardCode}`: ventas de 12 meses, solo si hay código SAP;
   - `cartera_vendor/{vendorKey}`: deuda, una lectura por vendedor que alcanza para todos sus clientes.
3. Cuando llega cada lectura, se vuelve a dibujar solo esa ficha.
4. El armado de los bloques es la función pura `buildFichaClienteMaster` (`src/pure/ficha-cliente-master.js`). No lee ni escribe Firestore.

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/pure/ficha-cliente-master.js` (nuevo) | Arma los bloques; `findCarteraCliente`, `fmtArs`, `fmtFecha` |
| `src/domains/master-clientes.js` | Disparador en el nombre, botón Ficha en provisorios, mapa id→fila, bloque v1539 al final (lecturas cacheadas, inserción de la fila, listener único, reapertura) |
| `src/main.js` | Expone `__phase0.pure.fichaClienteMaster` |
| `index.html` | CSS `.mc-ficha*` (junto a `.mc-table`); APP_VERSION v1539 |
| `sw.js` | CACHE_VERSION v1539 |
| `app.bundle.js` | Regenerado |
| Tests | `tests/unit/ficha-cliente-master.test.js`, `tests/unit/audit/master-ficha-cliente-v1539.test.js` |

## Pruebas ejecutadas y resultado

| Prueba | Resultado |
|---|---|
| Unit de la función pura: cliente del padrón vacío, alta SAP completa, entrega transportista/sucursal/retiro, «Cargando…», prioridad de coordenadas, helpers, que no mute la entrada | OK |
| Contrato de solo lectura: sin `update`, `doc().set/delete`, `collection().add`, batch ni transacciones; `fbDb` en un solo lugar; solo 3 colecciones leídas con `.get()`; lecturas cacheadas | OK |
| Contrato de enganche: nombre como disparador, botón en provisorios, listener una sola vez, fila insertada debajo, CSS | OK |
| Navegador (Playwright, app real, Firestore simulado), cliente del padrón en 1366 y 390 px: la ficha se abre debajo de su fila, muestra los datos de ese cliente (incluida la entrega por transportista), con dos fichas abiertas no se mezclan, sigue abierta tras el buscador, se cierra con un segundo toque, al reabrir no vuelve a leer, 0 escrituras, los inputs de dirección siguen | OK |
| Navegador, alta SAP + provisorio: código SAP, CUIT, ventas, dirección con número, CP; el botón Ficha del provisorio abre su ficha; 0 escrituras | OK |
| Suite unit completa / smoke / typecheck / lint | 2704 / 25 / 0 errores / limpio |

**Falta**: prueba manual en producción con datos reales: editar una dirección y Reasignar zonas con fichas abiertas.

## Campos que no pudieron incorporarse

- **No existen en la app**: país, direcciones adicionales (ship-to), contactos adicionales, horarios, observaciones comerciales y logísticas, CP/localidad de entrega por separado.
- **Están en SAP / BigQuery pero no en Firestore**: condición de pago, lista de precios, límite de crédito, saldo. Traerlos implica cambiar el sync, que queda fuera de este alcance.
- **Clasificación del vendedor guardada en su propio usuario** (`userData/{uid}.clientMeta` de cada vendedor): no se lee para no recorrer todos los usuarios. Se muestra la del usuario actual y la de `client_master`.
- **Constancias y fotos**: solo se indica si existen, porque son pesadas.

## Riesgos y limitaciones

1. La entrega (`defaultDelivery`) es la del último pedido, no una configuración fija. Para las altas SAP solo aparece si el nombre del alta coincide con el del pedido (punto 5.1).
2. Las filas de empleados SAP (`EMPL…`) están bloqueadas (`pointer-events:none`) desde v1303, así que no despliegan ficha.
3. La deuda depende de que el cliente esté en `cartera_vendor` del vendedor que muestra la columna. Si el vendedor de la cartera es otro, no aparece.
4. Si un filtro saca a un cliente de la lista, su ficha deja de verse. Vuelve a abrirse si el cliente reaparece.
