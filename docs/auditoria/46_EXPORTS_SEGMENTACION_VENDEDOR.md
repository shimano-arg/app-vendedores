# 46 — Exportaciones por vendedor: auditoría de las 11 categorías (2026-11-02)

> Auditoría READ-ONLY (CLAUDE.md §31). No se tocó código de la app. Rama `claude/laughing-allen-3odsg7-exports-segmentacion`.
> Toda afirmación lleva archivo:línea. Lo que no pude verificar (datos de prod, comportamiento runtime) está marcado **[NO VERIFICADO]**.

## Resumen

- De las 11 categorías, **5 tienen problema de segmentación**; las otras 6 están bien cerradas (ocultas al vendedor y bloqueadas en el servidor) o son globales por naturaleza.
- **Pedidos del mes, Backorder y Stock Asignado - líneas**: para el vendedor, el servidor SÍ filtra (solo trae pedidos con `assignedVendorUid` = su usuario). El problema es que ese campo se graba una sola vez, cuando se crea el pedido, y no se actualiza si después el cliente cambia de vendedor en el master. Así un vendedor puede recibir pedidos de clientes que hoy son de otro. Es la causa más probable de lo que reporta PACHI **[NO VERIFICADO contra prod]**. Aparte, la columna "Vendedor" del Excel sale de `ownerVendor` y no del master, así que puede mostrar el nombre de otro vendedor aunque el cliente sea propio.
- **Para los internos (VDI)** las cuatro exportaciones de pedidos y visitas salen **con todos los vendedores del país**: ni la consulta ni las reglas los limitan a sus parejas.
- **Masterfile Clientes** se filtra solo en el navegador, y el listado completo de clientes ya viene adentro de `index.html` (`POINTS`). Se puede saltear desde la consola. Para garantizarlo del lado del servidor habría que sacar el master del HTML: es un cambio grande.
- **Visitas y Contactos** a un vendedor común le debería tirar error de permisos (la consulta pide todas las visitas y las reglas no se lo permiten). Al VDI le baja las visitas de todos.

## Mapa de las 11 exportaciones

| Reporte (`data-exp-kind`) | Archivo / función (dispatch) | Fuente de datos | Campo vendedor | Filtro actual (vendedor) | Problema | Corrección |
|---|---|---|---|---|---|---|
| **VISITAS** — Visitas y Contactos | `index.html:4338` → `showMonthPicker('VISITAS')` → `confirmMonthPicker` `exports-core.js:865` → `exportVisitasForMonth` `exports-core.js:1032` | Firestore `visits` **sin where** (`exports-core.js:1036` `fbDb.collection('visits').get()`); el filtro por mes/año es en memoria (1043-1047) | `ownerUid` / `ownerEmail` / `vendor` (filas 1129-1130) | **Ninguno** en la consulta. Las reglas solo dejan listar al vendedor con `ownsDoc()` → para el VDE la consulta sin filtro **se rechaza** (error de permisos) **[inferido de las reglas, no probado en runtime]**. Interno/admin/gerente: trae todo | VDE: la opción aparece (`exports-core.js:778`) pero falla. VDI: exporta las visitas de todos los vendedores | Consulta `.where('ownerUid','==',uid)` para el VDE; para el VDI, `where('ownerUid','in',[uid, ...UIDs de sus parejas])`. Reglas: el VDE ya está bien. Para el VDI hace falta denormalizar las parejas (ver etapa 3) |
| **RENDICIONES** | `index.html:4342` → `showMonthPicker('RENDICIONES')` → `exportRendicionesForMonth` `exports-core.js:1206` | `rendiciones` **sin where** (`:1210`) | `ownerUid` / `ownerName` (`:1291-1292`) | Oculta para vendedor/interno (`exports-core.js:778-779`). Reglas: VDE solo lista las suyas (`firestore.rules:646`) | No son datos de clientes. Residual: el interno puede listar las rendiciones de todos desde la consola (`firestore.rules:646` `isInterno()`) | Ninguna para el objetivo pedido. Opcional: sacar `isInterno()` del list si el VDI no las necesita (verificar `rendiciones.js:198/804` primero) |
| **ALTAS** — Altas de clientes | `index.html:4346` → `showMonthPicker('ALTAS')` → `exportAltasForMonth` `exports-core.js:1476` | `client_applications` **sin where** (`:1480`) | `assignedVendor` / `ownerUid` / `vendorName` | Oculta para VDE/VDI. Reglas: VDE solo lee `assignedVendor == myVendorKey()` o propias (`firestore.rules:508-512`). Interno: todo | Si se le habilitara al VDE, la consulta sin where fallaría. VDI: todo (TODO pendiente desde v548, comentario `firestore.rules:505-507`) | Si se habilita para el VDE: consulta `where('assignedVendor','==',myVendorKey)` + otra `where('ownerUid','==',uid)` y unir los resultados |
| **MASTER** — Masterfile Clientes | `index.html:4350` → `exportMasterClientes` `exports-core.js:17` | `POINTS` **embebido en el HTML** (`index.html:7664`) + `approvedAltasList` + `clientMasterCache` (`client_master` completo) + `client_buyer_stats` completo (`exports-core.js:33`) | vendorKey del master: `getEffectiveVendorForClient` / `a.assignedVendor` (`:370`) | **Solo en el navegador**: `getEffectiveVendorSet(currentVendor)` (`exports-core.js:100-108` → `index.html:20213`, que usa `userRole`/`assignedVendor`, ambos `var` globales en `index.html:30669-30670`) | Se saltea desde devtools (`assignedVendor='GONZALO DE LA ROSA'` o leyendo `POINTS` directo). `client_master` lo puede leer cualquier usuario autenticado (`firestore.rules:426`) y `client_buyer_stats` también (`:996`) | Ver etapa 4: llevar el master a Firestore/CF con proyección por vendedor. Mientras tanto, solo se puede endurecer el filtro del navegador (no es garantía) |
| **PRECIOS_STOCK** — Lista de precios - disponible | `index.html:4354` → `exportPreciosStock` `exports-core.js:644` | `PRODUCTS` embebido + `app_config/stock_snapshot` + `getStockRealmenteDisponible` (usa `globalPedidos`) | — (global) | Oculta para vendedor/interno por `allowedByRole` (`exports-core.js:778-779`) y para PACHI por CSS (`index.html:2594`) | Global por naturaleza: no hay que segmentar. Nota: el comentario v986 (`index.html:32190-32192`) dice que PACHI tiene que verla, pero hoy está oculta (contradicción entre v986 y v1478). Si se le habilita a un VDE, el "libre" se calcularía solo con sus pedidos (el VDE no ve las reservas ajenas) → número inflado **[inferido]** | Ninguna de segmentación. Si se le muestra al VDE, el "libre" tiene que venir del servidor (snapshot / CF), no de `globalPedidos` |
| **BACKORDER** | `index.html:4358` → `exportBackorderAll` `exports-core.js:1777` (la variante por mes `exportBackorderForMonth` `:1560` solo se llega por consola: ningún botón llama `showMonthPicker('BACKORDER')`) | `globalPedidos` en memoria (`:1785`) ← listener `pedidos_all` `index.html:37927-37930` | `assignedVendorUid` (consulta) / `vendorKey` canon + fallback `clientMasterCache.assignedVendor` (columna) | VDE: **en la consulta** `where('assignedVendorUid','==',uid)` (`index.html:37929`), garantizado por las reglas (`firestore.rules:154-155`). VDI/admin/gerente: sin filtro (`:37930`) | (a) `assignedVendorUid` se graba al crear el pedido y no se re-sincroniza cuando cambia el master (no hay trigger sobre `vendor_overrides`/`client_applications`; grep en `functions/index.js` sin resultados) → el VDE puede recibir clientes que ya no son suyos y perder los que ahora sí. (b) VDI: exporta el backorder de todos | Etapa 1: el VDI filtra en el navegador por sus parejas. Etapa 2: script de realineación `assignedVendorUid` ↔ master (dry-run + `_backfill` §55) + trigger/CF que lo re-propague. Etapa 3: reglas para el VDI |
| **PENDIENTE_ASIG_PABLO** | `index.html:4363` → `exportPendienteDeAsignacionPablo` `exports-core.js:2113` | `ingresos_reparto` `where status in [pending,in_progress]` (`:2124-2127`) + `globalPedidos` | `p.ownerVendor \|\| p.vendorAssigned` (`:2228`) | Oculta para VDE/VDI. Reglas: solo admin/gerente (`firestore.rules:784`) | Ninguno (cerrada del lado del servidor) | Ninguna |
| **STOCK_ASIG** — Stock Asignado - líneas | `index.html:4369` → `exportStockAsigAll` `exports-core.js:1986` (por mes `:1668` solo por consola) | `globalPedidos` (`:1993`) ← mismo listener `pedidos_all` | igual que BACKORDER | igual que BACKORDER | igual que BACKORDER | igual que BACKORDER |
| **PEDIDOS_MES** — Pedidos del mes | `index.html:4373` → `showMonthPicker('PEDIDOS_MES')` → `exportPedidosMesForMonth` `exports-core.js:2368` vía `_iteratePedidosMes` `:1547` | `globalPedidos` filtrado por `createdAt` en memoria | Consulta: `assignedVendorUid`. **Columna "Vendedor": `p.ownerVendor`** (`:2397`) | VDE (PACHI incluido): en la consulta, garantizado por reglas. VDI/admin/gerente: todo | (a) `assignedVendorUid` desactualizado respecto al master (hipótesis principal del caso PACHI **[NO VERIFICADO]**). (b) La columna Vendedor sale de `ownerVendor` (legacy = quien cargó) y no del master → aparecen nombres de otros vendedores. (c) VDI: global | Columna Vendedor = resolución del master (`vendorAssigned` o resolver §46). Realineación de datos (etapa 2). Filtro VDI (etapa 1/3) |
| **VENTAS_ART_CLI** — Ventas × artículo × cliente / vendedor | `index.html:4379` → `_ventasArtCliClick` `exports-core.js:2572` (corta si no es admin/gerente) → `showMonthPicker('VENTAS_ART_CLI')` → `exportVentasArtCliForMonth` `:2299` → callable `generateVentasReportCF` | BigQuery `v_ventas_lineas` + `client_master` + `sap_vendors` (server, `functions/index.js:3072-3076`) | SlpCode/vendor dentro del CF | **Del lado del servidor**: el CF exige rol admin/gerente (`functions/index.js:3091-3095`) | Ninguno | Ninguna (si se quisiera una versión por vendedor, la haría el CF filtrando por el vendor de `roles/{uid}`) |
| **INFRACCIONES_MELI** | `index.html:4387` → `exportInfraccionesMeli` `exports-advanced.js:1292` | doc `meli_infracciones_resumen/current` | — (global, por seller MELI) | Lista de emails en el navegador (`exports-core.js:785-795`) + reglas `canReadInfraccionesMeli()` (`firestore.rules:98-105`, `969-971`) | Ninguno | Ninguna |

## Garantía del lado servidor por fuente

| Fuente | Regla (firestore.rules) | ¿Puede un VDE leer datos de otros desde la consola? |
|---|---|---|
| `pedidos` | `150: allow get: if isReader();` · `154-155: allow list: if isAdminOrGerente() \|\| isInterno() \|\| (isVendor() && (ownsDoc() \|\| resource.data.assignedVendorUid == request.auth.uid));` | **list: NO** (una consulta sin filtro de dueño se rechaza; con `ownerUid==yo` trae lo que cargó él, aunque el cliente sea ajeno). **get: SÍ**: cualquier pedido conociendo su id. Los ids aparecen en `revision_waitlist` (`pedidosOrigenes`/`asigRefs`), que todos pueden leer → se pueden enumerar pedidos ajenos **[inferido]**. VDI: list de todo |
| `visits` | `279: allow get: if isReader();` · `280: allow list: if isAdminOrGerente() \|\| isInterno() \|\| (isVendor() && ownsDoc());` | list: NO. get por id: sí. VDI: todo |
| `rendiciones` | `645: allow get: if isReader();` · `646: allow list: … \|\| isInterno() \|\| (isVendor() && ownsDoc());` | list: NO. VDI: todo |
| `client_applications` | `508-512: allow read: if isAdminOrGerente() \|\| isViewer() \|\| isInterno() \|\| (isVendor() && (resource.data.assignedVendor == myVendorKey() \|\| resource.data.ownerUid == request.auth.uid));` | NO (salvo las que creó él). VDI/viewer: todo |
| `client_master` | `426: allow read: if isReader();` | **SÍ, todo** |
| `client_buyer_stats` | `995-997: allow read: if request.auth != null;` ("todos los roles ven buyer de todos los clientes — decisión Mariano") | **SÍ, todo** (decisión explícita) |
| `POINTS` (clientes del mapa) | No es Firestore: es una constante en `index.html:7664` | **SÍ, todo**, y probablemente sin login si `index.html` es público en Pages **[NO VERIFICADO]** |
| `revision_waitlist` | `924: allow read: if isReader();` | **SÍ, todo** (no la usa ninguna exportación, pero tiene clientes, SKUs y precios de las órdenes ajenas) |
| `app_config/stock_snapshot` | `685-688` (rama `!(docId in [...]) && isReader()`) | Sí (global por naturaleza) |
| `ingresos_reparto` | `784: allow read: if isAdminOrGerente();` | NO |
| `meli_infracciones_resumen` | `970: allow read: if canReadInfraccionesMeli();` | NO |
| BigQuery (`generateVentasReportCF`) | CF: `functions/index.js:3091-3095` rol admin/gerente desde `roles/{uid}` | NO |

Conclusión: para **pedidos** el filtro de la consulta ya está garantizado por el servidor (bien). Para **master** y **waitlist** no hay garantía: cualquier vendedor lee todo.

## Matriz de permisos por rol

Visibilidad de la opción en el modal: `exportToExcel` (`exports-core.js:765-801`). `allowedByRole` cubre solo vendedor e interno; el resto de los roles (`null`) ve todo menos INFRACCIONES (lista de emails). Para PACHI se suma el CSS `body.is-pachi-restricted` (`index.html:2594`), que deja solo PEDIDOS_MES y MASTER. El código v986 (`index.html:32193-32202`) pisa `style.display` al loguearse, pero `exportToExcel` lo vuelve a aplicar cada vez que se abre el modal → lo que manda es `allowedByRole` + CSS.

Leyenda: **Op** = se ve la opción · **Datos** = qué baja hoy.

| Categoría | Admin | Gerente | Interno (VDI) | Vendedor | PACHI |
|---|---|---|---|---|---|
| VISITAS | Op · todo | Op · todo | Op · **todo el país** | Op · **error de permisos** [inferido] | oculta (CSS) |
| RENDICIONES | Op · todo | Op · todo | oculta (pero las reglas le dejan listar todo) | oculta | oculta |
| ALTAS | Op · todo | Op · todo | oculta | oculta | oculta |
| MASTER | Op · todo | Op · todo | Op · parejas (solo en el navegador) | Op · su zona (solo en el navegador) | Op · su zona (solo en el navegador) |
| PRECIOS_STOCK | Op · global | Op · global | oculta | oculta | oculta (CSS; contradice v986) |
| BACKORDER | Op · todo | Op · todo | Op · **todo el país** | Op · `assignedVendorUid`=yo | oculta |
| PENDIENTE_ASIG_PABLO | Op · todo | Op · todo | oculta (reglas: denegado) | oculta (reglas: denegado) | oculta |
| STOCK_ASIG | Op · todo | Op · todo | Op · **todo el país** | Op · `assignedVendorUid`=yo | oculta |
| PEDIDOS_MES | Op · todo | Op · todo | Op · **todo el país** | Op · `assignedVendorUid`=yo | Op · `assignedVendorUid`=yo |
| VENTAS_ART_CLI | Op · todo | Op · todo | oculta (CF: denegado) | oculta (CF: denegado) | oculta |
| INFRACCIONES_MELI | solo 3 emails | solo 3 emails | no | no | no |

Rol `viewer`: existe en las reglas (`firestore.rules:31`) y ve todas las opciones, pero `pedidos.list` no lo incluye (`:154`) → sus exportaciones de pedidos saldrían vacías **[inferido]**.

**VDI**: según §46/§50, los clientes de un VDI son los de sus parejas (VDE con `internalPartnerUid` apuntando a él, más `VENDOR_INCLUDES_OTHERS`), más su zona propia (`getMyAllowedVendorKeys`, `index.html:20125-20141`). El mapa y el master ya aplican ese alcance en el navegador. Las reglas tratan al interno como admin para leer (`isInterno()` en pedidos/visits/rendiciones/client_applications), y el comentario `firestore.rules:505-507` lo deja como TODO desde v548.

## Otras pantallas que leen las mismas colecciones como vendedor (riesgo al endurecer reglas)

| Colección | Lecturas del VDE / VDI que dependen de la regla actual | Riesgo si se endurece |
|---|---|---|
| `pedidos` **get** (`isReader`) | Lecturas por id de pedidos de origen en CPST / reparto / planner: `index.html:17230`, `18840`, `37485`, `38762` (con `getReadOptionsForPath('pedidos')`) | ALTO: restringir `get` al dueño rompe CPST y la unificación cuando el pedido de origen lo cargó otro (caso BROBRO §61/§63). Habría que mover esas lecturas a un CF |
| `pedidos` **list** con `ownsDoc()` | Consultas sin filtro de dueño (`index.html:12614` por `clientCardCode`, `18453` por `_draftId`, `24707` por `clientCardCode`) **ya se rechazan hoy** para el VDE; la 12614 tiene `.catch` que lo silencia **[inferido; bug aparte, fuera de alcance]** | Bajo: quitar `ownsDoc()` solo afecta pedidos legacy sin `assignedVendorUid` (comentario `index.html:37839-37842`) |
| `visits` | `visitas.js:411`, `dashboard.js:1288`, `rutas.js:527` (`ownerUid`=yo); VDI: `index.html:20300` (pareja) | Bajo para el VDE (ya está restringido). Para el VDI: restringir a las parejas obliga a denormalizarlas en `roles` |
| `client_master` (`isReader`) | Listener global `master-clientes.js:150`; ficha `index.html:23097`; `clientMasterCache` alimenta el fallback de vendedor en backorder/stock (`exports-core.js:1576-1590`) y la entrega por defecto | ALTO: el mapa, la ficha y los pedidos esperan el master completo. No conviene endurecer sin rediseño |
| `client_buyer_stats` | Ficha cliente + master | Medio (hay decisión explícita de Mariano de dejarlo abierto) |
| `revision_waitlist` (`isReader`) | §42.1 consulta fresca por `clientCardCode` (cross-vendor obligatoria), filtro del sidebar §59 en el navegador | ALTO: §42/§42.2 necesitan ver las órdenes de cualquier cargador para el mismo cliente |
| `client_applications` | `notificaciones.js:115` (`ownerUid`), `approvedAltasList` (mapa) | Bajo para el VDE (ya está restringido) |
| `rendiciones` | `rendiciones.js:198` (`ownerUid`=yo), `:804` | Bajo |

## Propuesta de corrección por etapas (de menor a mayor riesgo)

**Etapa 0 — Diagnóstico de datos (sin cambiar código, con gate humano §31).**
Script read-only `scripts/audit/AT_pedidos_vendor_vs_master.cjs` (a crear): para cada pedido con `assignedVendorUid`=UID de PACHI (y de cada VDE), resolver el vendedor actual del master (cadena §46/§50, reusando el resolver de `scripts/audit/Q_vendedor_desalineado.cjs`) y listar las diferencias. Así se confirma o se descarta la hipótesis principal del caso PACHI antes de tocar nada.

**Etapa 1 — Navegador (bajo riesgo, no es garantía).**
1. PEDIDOS_MES: columna "Vendedor" desde el master (`vendorAssigned`, o resolver §46), no `ownerVendor`.
2. VDI: en BACKORDER, STOCK_ASIG, PEDIDOS_MES y VISITAS filtrar por `getEffectiveVendorSet()` (o por los UIDs de las parejas), igual que el master.
3. VISITAS para el VDE: consulta `where('ownerUid','==',uid)` para que deje de fallar.
4. Defensa en profundidad: el filtro de las exportaciones de pedidos re-chequea `p.assignedVendorUid === currentUser.uid` cuando el rol es vendedor (`currentUser.uid` viene de Auth, no se puede falsificar como `userRole`).

**Etapa 2 — Datos + servidor (riesgo medio).**
1. Backfill de realineación `assignedVendorUid`/`vendorAssigned` ↔ master en pedidos abiertos y del período, con dry-run + snapshot `_backfill` (§55) y OK de Mariano.
2. Trigger (o paso dentro del sync) que re-propague el vendedor a los pedidos abiertos cuando cambia `vendor_overrides` o `client_applications.assignedVendor`. Sin esto el desfasaje vuelve.
3. Opcional: un CF `exportPedidosCF` (patrón `generateVentasReportCF`) que arme PEDIDOS_MES / BACKORDER / STOCK_ASIG del lado del servidor, con el alcance por rol calculado en el servidor (VDE = clientes del master de su `roles.vendor`, VDI = parejas). Es la única forma de que la regla "sus clientes según el master" (y no "pedidos con mi UID") quede garantizada.

**Etapa 3 — Reglas (riesgo alto, necesita pruebas §90 con un usuario vendedor y un usuario interno).**
1. Denormalizar en `roles/{uid}` de cada VDI la lista `partnerVendorUids` (o `partnerVendorKeys`), mantenida por el admin o por un CF.
2. `pedidos.list` / `visits.list` para el interno: `assignedVendorUid in roles.partnerVendorUids` (y `ownerUid in ...` para visits). Antes hay que confirmar que todas las pantallas del VDI consultan con ese filtro (hoy `pedidos_own`/`pedidos_all` consultan sin filtro: `index.html:37844`, `37930`). Si no, se rompen.
3. `pedidos.get`: NO tocar hasta que CPST/reparto lean el pedido de origen vía CF.

**Etapa 4 — Master (riesgo alto, rediseño).**
Sacar `POINTS` del HTML a una fuente servida por vendedor (colección con `vendorKey` y reglas por `myVendorKey()`, o un CF que devuelva la proyección). Afecta mapa, rutas, seguimiento, ficha y pedidos. Necesita plan propio (`writing-plans`). Hasta entonces, el master para el VDE es "filtrado de cortesía".

## Pruebas propuestas

Usuarios: PACHI (`pachinaba@gmail.com`, vendedor), otro VDE (ej. Gonzalo De La Rosa), un VDI (Santiago Esteban o Ioannis) y admin. Para cada uno: (1) exportar desde el modal, (2) intentar el bypass desde la consola.

| Categoría | PACHI | Otro VDE | VDI | Admin |
|---|---|---|---|---|
| PEDIDOS_MES | Excel: todos los `CardCode` resuelven a PACHI en el master; columna Vendedor = PACHI. Consola: `fbDb.collection('pedidos').get()` → permission-denied; `.where('ownerUid','==',uid).get()` → listar si aparecen clientes ajenos | Ídem con su zona | Hoy: global (falla). Esperado: solo las parejas | Todo |
| BACKORDER / STOCK_ASIG | Opción oculta (CSS). Consola: `exportBackorderAll()` → solo sus pedidos | Solo `CardCode` de su zona | Esperado: parejas | Todo |
| VISITAS | Oculta. Consola: `showMonthPicker('VISITAS')` → hoy error; esperado: solo las suyas | Hoy: error de permisos; esperado: solo las suyas | Esperado: propias + parejas | Todo |
| MASTER | Solo Z4. Consola: `assignedVendor='GONZALO DE LA ROSA'; exportMasterClientes()` → hoy baja Gonzalo (documentar como riesgo aceptado hasta la etapa 4) | Su zona | Parejas | Todo |
| PRECIOS_STOCK | Oculta (definir si debe verse, ver preguntas) | Oculta | Oculta | Global |
| RENDICIONES / ALTAS | Ocultas; consola `fbDb.collection('rendiciones').get()` → denegado | Ídem | Hoy permitido por reglas (todo) | Todo |
| PENDIENTE_ASIG_PABLO | Consola `exportPendienteDeAsignacionPablo()` → denegado (reglas) | Ídem | Denegado | Todo |
| VENTAS_ART_CLI | Consola: `httpsCallable('generateVentasReportCF')({year,month})` → `permission-denied` | Ídem | Ídem | Excel OK |
| INFRACCIONES_MELI | Consola: `getDoc meli_infracciones_resumen/current` → denegado | Ídem | Ídem | Denegado, salvo los 3 emails |

Tests automáticos sugeridos: rules-unit-testing para `pedidos.list`/`visits.list` por rol (incluir VDI con `partnerVendorUids` cuando exista); test puro del filtro de exportación (`assignedVendorUid === uid`) y de la columna Vendedor desde el master.

## Preguntas abiertas para Mariano

1. **"Sus clientes" = master actual o `assignedVendorUid` del pedido?** Si un cliente pasó de Gonzalo a PACHI, ¿los pedidos viejos los ve PACHI, Gonzalo o los dos? Define si alcanza con realinear los datos o si hace falta un CF que filtre por el master.
2. **VDI**: ¿exporta solo sus parejas (como el mapa) o el país entero (como hoy)? Si son las parejas, ¿se puede guardar la lista de parejas en `roles/{uid}` (etapa 3)?
3. **Pedidos cargados por el vendedor para clientes de otro** (`ownerUid` = él, `assignedVendorUid` = otro): ¿los puede ver/exportar? Hoy las reglas se lo permiten (`ownsDoc()`).
4. **Masterfile**: ¿se acepta que hoy es "filtrado de cortesía" (el listado completo ya está en el HTML) o hay que priorizar la etapa 4?
5. **PACHI y Lista de precios**: el código v986 dice que PACHI la ve, el CSS v1478 la oculta. ¿Cuál vale?
6. **Visitas**: ¿se exportan las visitas hechas POR el vendedor (`ownerUid`) o las visitas A sus clientes (incluidas las que hizo el VDI en su nombre)?
7. ¿Autorizás correr el script read-only de la etapa 0 contra prod para confirmar la causa del caso PACHI?
8. `revision_waitlist` y `pedidos.get` son legibles por cualquier vendedor (necesario para §42 y CPST). ¿Se acepta como riesgo residual o se planifica pasarlos a CF?

## Lo que no pude verificar

- Datos de prod: si los pedidos que vio PACHI tienen `assignedVendorUid` = su UID con un master de otro vendedor (etapa 0).
- El rol real de PACHI en `roles/{uid}` (el comentario de `firestore.rules:63` dice `role=vendedor`; si no lo fuera, el listener le traería todo sin filtro).
- El comportamiento runtime de VISITAS para el VDE (el error de permisos lo deduzco de las reglas).
- Si `index.html` (con `POINTS`) se sirve sin autenticación.
