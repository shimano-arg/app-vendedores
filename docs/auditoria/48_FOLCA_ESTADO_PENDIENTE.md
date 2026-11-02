# 48 — APP-05: por qué FOLCA S.R.L. aparece «Pendiente» (2026-11-02)

Investigación solo de código. No se tocaron Firestore, SAP ni el código de la app. Los datos reales del cliente salen del script de solo lectura `scripts/audit/AU_folca_estado_pendiente.cjs`, que tiene que correr Mariano porque desde esta sesión no hay acceso a la base.

**Estado**: falta la corrida del script y la captura. La captura del pedido no llegó adjunta, así que todavía no sé en qué pantalla exacta aparece el «Pendiente».

## 1. Lo que ya se sabe del cliente

- **CardCode**: `C30710893981` (FOLCA S.R.L.).
- **Tiene dos documentos en `client_applications`** con el mismo CardCode, cada uno con un vendedor distinto (SANTIAGO y PACHI). Esto quedó registrado el 2026-09-29 al armar la vista BigQuery `v_clientes_360_dedup` (`bigquery/slp_asignado/deploy_slp_asignado.py:277-284`). Es uno de los tres CardCodes duplicados que se conocían; los otros son `C20346628988` y `C33718355449`.
- No está en el padrón histórico `POINTS`: la localidad Arroyito (Córdoba) solo tiene a "ROMA DIEGO LUCIO" (`index.html`, constante `POINTS`). Por eso la app lo trata como **alta SAP**, no como cliente del padrón.

## 2. La División 3 NO es la causa (evidencia de código)

- Los dos sincronizadores de clientes de SAP **aceptan** la División 3:
  - Python: `scripts/sync_sap_to_firestore.py:1171-1182`. Los códigos son 1 = BIKE, 2 = PESCA, 3 = BIKE & PESCA, y se aceptan `'2'`, `'3'`, `'PESCA'`, `'BIKE & PESCA'` y `'BIKE&PESCA'`.
  - Cloud Function: `functions/core/sync-bp-pesca-core.js:473` (`PESCA_DIVISION_VALUES`) y `:682`. Es la misma lista.
- Si FOLCA fuera de una división no aceptada, **no estaría en la app**. Como aparece, pasó el filtro.
- Después de la sincronización, la división solo se guarda como dato (`client_applications.sapDivision`, `sync-bp-pesca-core.js:545`). **Ninguna pantalla ni regla la usa para decidir un estado.** En el front, `sapDivision` solo aparece en la ficha nueva v1539 y al copiar campos en `master-clientes.js:1981`.
- No hay reglas distintas para Pesca/Bici y para otras divisiones.

## 3. Todos los «Pendiente» que puede mostrar la app

La palabra «Pendiente» sale de lugares que no tienen relación entre sí:

| # | Dónde se ve | Qué significa | Cómo se calcula | Código |
|---|---|---|---|---|
| A | Modal del cliente del padrón → "Estado del cliente" | Marca comercial del vendedor: nadie lo marcó **Habilitado** ni **Cancelado** | `getClientState(key)`: está en `contacted` → habilitado; en `canceled` → cancelado; si no, **pendiente**. Las marcas viven en `userData/{uid}.contacted/canceled` de cada usuario | `index.html:9233-9244`, badge `:5955`, lista `:12039` |
| B | Lista de clientes, filtro "Leads" (internamente `pendientes`) | Alta SAP **sin geolocalizar o sin dirección**, o provisorio sin CardCode | `hasGeo = lat/lng`, `hasAddr = calle‖address`; si falta alguno, queda en "pendientes" | `index.html:11892-11901` |
| C | Contador "PENDIENTES" del encabezado / Provisorios | Altas rápidas sin CardCode SAP | `manualSapPending && !cardCodeSap` | `index.html:~11860-11866` |
| D | Notificaciones → Altas de clientes → Mis solicitudes | Solicitud de alta **sin las 2 aprobaciones** | `status === 'pending_approval'` (se aprueba al llegar a 2 aprobaciones) | `src/domains/notificaciones.js:640-669, 982` |

Ninguna depende de la división, de SAP en tiempo real ni del Master de Clientes.

**Sobre A**: para un alta SAP (FOLCA no está en `POINTS`), la tarjeta de la lista no muestra «Pendiente». Muestra "SAP en mapa / SAP sin geocodificar / SAP sin dirección" (`index.html:11929-11937`). A solo aplica a clientes del padrón.

## 4. Hipótesis, de más a menos probable

1. **B: le falta geolocalización o dirección.** Si la captura es de la lista de clientes con el filtro "Leads"/pendientes, o de un contador de pendientes, la causa es `lat/lng` o `calle` vacíos en el doc de FOLCA. Pasa seguido con altas que llegan por sync de SAP: el sync trae `calle` = `Address` de SAP, pero `lat/lng` solo se completan cuando alguien geolocaliza la dirección en la app.
2. **D: uno de los dos documentos duplicados es una solicitud de alta manual** (`status = pending_approval`) que quedó sin aprobar, mientras el otro llegó por sync con CardCode. Encaja con "dos docs, vendedores distintos": un vendedor cargó la solicitud y el sync creó otra.
3. **Duplicado en sí (problema de asignación comercial)**: aunque no sea la causa del «Pendiente», tener dos docs con el mismo CardCode y dos vendedores hace que FOLCA aparezca dos veces, una por vendedor, y que el vendedor de la ficha dependa de cuál doc se lea.
4. **A**: solo si existe un FOLCA también en el padrón con otro nombre. El script lo detecta por `clientMeta` y las marcas de `userData`.

Descartadas con evidencia de código: **2 (División 3 no sincronizada)** y **4 (error en la lógica de Pendiente por división)**.

## 5. Qué confirma el script

`node scripts/audit/AU_folca_estado_pendiente.cjs` (solo lectura):

1. Todos los docs de FOLCA con sus campos, sin fotos ni constancias, y los motivos de «pendiente» de cada uno: aprobación, CardCode, geolocalización, dirección, vendedor, provincia, inactivo o bloqueado en SAP.
2. `client_master` y `sap_clients` relacionados.
3. Si algún usuario lo marcó Habilitado o Cancelado, o le cargó datos.
4. Por cada división, cuántas altas SAP quedan «pendientes» y por qué motivo, más la lista completa de CardCodes duplicados. Esto responde **si hay un problema general con la División 3**: si los porcentajes de la División 3 son parecidos a los de la 2, no es un problema de división.
5. Hasta 5 clientes de División 3 en Córdoba sin ningún motivo de pendiente, para comparar.

Verificación del lado SAP en BigQuery (solo lectura; la tabla `sap_bp_raw` tiene `u_division`, `valid` y `frozen`):

```sql
SELECT card_code, card_name, u_division, valid, frozen, sales_person_code, address, city, state, update_date
FROM `app-vendedores-shimano.shimano_app.sap_bp_raw`
WHERE card_code = 'C30710893981';
```

## 6. Soluciones según lo que dé el script (no aplicadas)

| Resultado | Corrección | Riesgo |
|---|---|---|
| Falta `lat/lng` o `calle` | Cargar o geolocalizar la dirección desde Master de Clientes ("Guardar"). No requiere código | Ninguno |
| Un doc en `pending_approval` | Unificar los dos docs (herramienta "Vincular SAP" / lead merge existente) o borrar la solicitud vieja, eligiendo antes el vendedor correcto (SANTIAGO o PACHI) | Al borrar el doc equivocado se pierden sus visitas o su vendedor: hay que elegir cuál queda |
| Duplicado con dos vendedores | Decidir el vendedor y dejar un solo doc. Prevención: que el sync no cree un doc nuevo si ya existe uno con el mismo CardCode (revisar `findMatch` en `sync-bp-pesca-core.js`) | Cambio de código del sync: requiere su propio PR y pruebas |
| Marca vieja en `userData` (caso A) | Tocar Habilitado en el modal del cliente | Ninguno |

**¿Afecta a otros clientes de Pesca/Bici?** Por código, no hay ninguna regla que trate distinto a la División 3. El script (punto 4) muestra si otros clientes de División 3 están en la misma situación por los motivos comunes: sin geolocalización, sin dirección, sin aprobar o duplicados.
