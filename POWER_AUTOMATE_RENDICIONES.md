# Power Automate — Flow rendiciones a SharePoint

Documento operativo del flow que mueve rendiciones aprobadas desde el email
automático (Lun/Mié 9 AM AR) a la SharePoint List **"ANTICIPO Y RENDICION
DE GASTO"** del team SAR.

Última actualización: 2026-07-29 (cambio Mariano — Excel filtrado por dupla como adjunto SharePoint)

---

## Schema de TablaGastos (v3)

A partir del commit donde se actualizó `scripts/send_rendiciones_email.py`,
TablaGastos tiene **una fila por dupla (ownerEmail, tipoGasto)** con una
columna adicional que apunta al Excel filtrado de esa dupla.

| Columna Excel | Tipo | Ejemplo | Cómo usar |
|---|---|---|---|
| `Vendedor (email)` | texto | `gonzalo.delarosa@shimano.uy` | columna SharePoint "Vendedor" |
| `Tipo gasto` | texto | `Factura A` / `Gastos con comprobante` / `Gastos sin comprobante` | columna SharePoint "Tipo comprobante" |
| `Cant Rendiciones` | número | `3` | columna SharePoint "Cant rendiciones" |
| `Importe Total` | número | `45000.00` | columna SharePoint "Importe" (el sumado) |
| `Importe USD Total` | número | `42.50` ó vacío | columna SharePoint "Importe USD" |
| `Moneda` | texto | `ARS` ó `MIXTO` | columna SharePoint "Moneda" |
| `Periodo Desde` | texto fecha | `2026-06-22 14:35` | columna SharePoint "Desde" |
| `Periodo Hasta` | texto fecha | `2026-06-29 10:12` | columna SharePoint "Hasta" |
| `Rendiciones IDs` | texto largo | `id1;id2;id3` | columna SharePoint "Rendiciones IDs" (texto, NO multi) |
| `Fotos URLs` | texto largo | `url1;url2;url3` | NO va como columna — son los adjuntos |
| `Excel Dupla URL` **(NUEVA v3)** | URL | `https://storage.googleapis.com/.../gonzalo_facturaA.xlsx` | NO va como columna — se usa para descargar el Excel filtrado y adjuntarlo al item |

---

## Cambios al flow en Power Automate

El flow existente probablemente tiene esta estructura (de tu config en sesión
previa):

```
1. Trigger: When a new email arrives (V3) — Office 365 Outlook
2. Condition: subject contains "Rendiciones aprobadas"
3. Save attachment to OneDrive (el Excel)
4. List rows present in a table — TablaGastos
5. Apply to each: por cada row
   5a. Create item — SharePoint List "ANTICIPO Y RENDICION DE GASTO"
```

### Cambios requeridos para v2

**5a. Create item — actualizar mapeo de columnas:**

| Columna SharePoint | Antes (v1) | Ahora (v2) |
|---|---|---|
| Vendedor | `Vendedor (email)` | `Vendedor (email)` (igual) |
| Tipo comprobante | `Tipo gasto` | `Tipo gasto` (igual) |
| Importe | `Importe` (de un gasto) | `Importe Total` (sumado) |
| Cant rendiciones | _no existía_ | `Cant Rendiciones` (NUEVO) |
| Moneda | `Moneda` | `Moneda` (igual, puede ser "MIXTO") |
| Desde | _no existía_ | `Periodo Desde` (NUEVO) |
| Hasta | _no existía_ | `Periodo Hasta` (NUEVO) |
| Rendiciones IDs | _no existía_ | `Rendiciones IDs` (NUEVO, multilínea) |

Si en SharePoint las 4 columnas nuevas no existen, hay que crearlas primero
en la List (Add column → Single line of text o Number según corresponda).

**Después del Create item — agregar manejo de adjuntos:**

Nuevos pasos dentro del Apply to each:

```
5b. Compose — "Split fotos"
    Expression: split(item()?['Fotos URLs'], ';')
    Output: array de URLs (puede ser vacío)

5c. Apply to each — sobre output de Compose 5b
    5c.1. HTTP — GET
          URI: item() (cada URL del array)
          Method: GET
          (No auth — son URLs públicas de Firebase Storage)
    5c.2. SharePoint — Add attachment
          Site: <tu site SAR>
          List: ANTICIPO Y RENDICION DE GASTO
          Id: outputs('Create_item').body/ID  (del paso 5a)
          File name: concat('foto_', iterationIndexes('Apply_to_each_2'), '.jpg')
                     (o usar el último segmento de la URL como nombre)
          File content: body('HTTP') (el binario que devolvió el GET)

5d. **Cambio v3 (2026-07-29)** — SharePoint Add attachment del Excel FILTRADO
    Antes se adjuntaba el Excel MAESTRO completo del OneDrive (paso 3) → cada
    item tenia todas las rendiciones de todos los vendedores. Ahora usamos el
    Excel filtrado por dupla que el script Python subio a Firebase Storage.

    5d.1. HTTP — GET
          URI: item()?['Excel Dupla URL']   (columna nueva de TablaGastos)
          Method: GET
          Auth: none (URL publica de Firebase Storage)
          IMPORTANT: si el campo esta vacio (fallo el upload al Storage),
          skipear con Condition antes del HTTP.
    5d.2. SharePoint — Add attachment
          Site: <tu site SAR>
          List: ANTICIPO Y RENDICION DE GASTO
          Id: outputs('Create_item')?['body/ID']  (del paso 5a)
          File name: concat('Rendiciones_', item()?['Vendedor (email)'],
                             '_', item()?['Tipo gasto'], '.xlsx')
                     Nota: SharePoint no permite `/` `\` `:` `*` `?` `"` `<` `>` `|`
                     en el filename — si aparecen en tipoGasto reemplazar con `_`.
          File content: body('HTTP')  (el binario xlsx)

5e. (Opcional) — Adjuntar tambien el Excel MAESTRO al primer item o borrarlo
    Si preferís mantener el Excel maestro adjunto tambien (para que Fernando
    pueda ver la lista completa desde SharePoint), agregar un Condition
    "iterationIndexes eq 1" y solo entonces adjuntar la variable del paso 3.
    Alternativa mas simple: dejar el maestro en el email/OneDrive y en
    SharePoint solo el filtrado.
```

---

## Limites a tener en cuenta

| Limite | Valor | Mitigación |
|---|---|---|
| Tamaño max attachment SharePoint | 250 MB por archivo | OK — fotos típicas pesan <2 MB |
| Cantidad max attachments por item | ~250 | Si una persona tuviera 250+ facturas en un período, partir el flow |
| Tiempo max ejecución flow | 30 min (free) / 1 año (premium) | Para 50 duplas con 3 fotos c/u: ~5 min, OK |
| Rate limit HTTP en Power Automate | 600 calls/min | OK — los GET son secuenciales |

---

## Trade-offs y decisiones

### ¿Por qué agrupamos en Python y no en Power Automate?

Lo discutimos cuando armamos esta v2. Se eligió la opción híbrida porque:

1. **Lógica de agrupación en código** = testeable, versionado, refactorizable.
2. **Manejo de attachments en Power Automate** = lo que hace nativo, sin
   tocar Microsoft Graph API desde Python.
3. **Hoja "Detalle"** queda en el Excel para auditoría (cero costo extra).
4. Si Fernando mañana cambia el criterio de agrupación (ej. agregar mes
   como tercera dimensión), se toca solo Python y el flow no cambia.

### ¿Qué pasa si una rendición no tiene foto?

- Se incluye en el agrupado igual (la suma del importe es correcta).
- No suma URL al campo `Fotos URLs`.
- En la hoja "Detalle" sale como `(sin foto)` para que se vea explícito.
- En SharePoint, el item se crea con menos adjuntos. No falla nada.

**Nota (fix 2026-07-27)**: si TODAS las rendiciones de una dupla no tienen foto, `Fotos URLs` queda como string vacío `""`. El `split("", ";")` en Power Automate devuelve `[""]` (array con 1 string vacío), no array vacío. El For each foto URL iteraba 1 vez con URI null → `InvalidTemplate error`. Fix aplicado en el Compose "Split Fotos URLs": expression cambiada a `if(empty(item()?['Fotos URLs']), createArray(), split(item()?['Fotos URLs'], ';'))` — devuelve array vacío cuando input es vacío, For each itera 0 veces.

### ¿De dónde saca el script Python el URL de la foto?

Depende de cuándo se creó la rendición:

- **v308+ (rendiciones nuevas)**: la app sube la foto a Firebase Storage al crear la rendición y guarda la URL pública en el campo `fotoTicketUrl` de Firestore. El Python la reusa directo (skip re-upload).
- **pre-v308 (rendiciones viejas)**: la foto vive como base64 dataURL en el campo `fotoTicket` (o `adjunto` legacy). El Python la sube a Storage y usa la URL nueva.

Bug observado 2026-07-27: el Python solo leía `fotoTicket`/`adjunto` (pattern viejo), ignorando `fotoTicketUrl`. Resultado: rendiciones post-v308 aparecían como "sin foto" en el Excel aunque la foto existiera. Fix aplicado (commit posterior a 2026-07-27) — el script ahora dispatchea entre los 2 casos.

### ¿Qué pasa si la foto falla al subir a Storage?

- Se incluye el importe en la suma (no se descarta el gasto).
- No suma URL.
- En la hoja "Detalle" sale como `(error al subir)`.
- Mariano puede inspeccionar el log de GitHub Actions para ver el error
  específico (`[storage] no pude subir foto <id>: <error>`).

### ¿Por qué no se borró la columna `Importe USD` aunque casi siempre va a ser 0?

Para que cuando empiecen a aparecer gastos en USD (compra Shimano Japón,
herramientas importadas, etc.) no haya que tocar nada — ya está la columna
preparada.

---

## Plan de migración (cuándo aplicar los cambios al flow)

1. Push del cambio Python al repo (commit con la modificación de
   `send_rendiciones_email.py`).
2. **Antes del próximo cron (próximo Lun o Mié 9 AM AR)**:
   - Crear las 4 columnas nuevas en la SharePoint List (v2 — Desde/Hasta/Cant/IDs si aún no están).
   - Editar el flow en Power Automate: actualizar mapping Create item +
     agregar bloque de attachments.
   - Test corriendo el workflow manualmente con `FORCE_SEND=true` desde
     GitHub Actions (sin marcar como notificadas).
3. Verificar en SharePoint:
   - Un item por dupla (ej. Gonzalo Factura A: 1 item con suma).
   - Cada item con sus fotos adjuntas.
   - Excel original también adjunto al primer item (opcional).
4. Si OK: dejar correr el próximo cron automático.
5. Si no OK: revertir el flow al mapping viejo (no toca el Python — el Excel
   tiene la hoja "Detalle" con el formato ungroupeado por si Fernando
   quiere usar ese mientras se ajusta el flow).

---

## Plan de migración v3 (2026-07-29) — Excel filtrado por dupla como adjunto

Contexto: hasta v2 el flow adjuntaba a cada item de SharePoint el Excel MAESTRO
completo del OneDrive (paso 5d viejo). Al abrir un item específico (ej. Federico
Factura A) el Excel adjunto tenía las N rendiciones de TODOS los vendedores —
Mariano tenía que scrollear/filtrar manualmente para ver solo las de esa fila.

### Cambios v3:

1. **Firebase Storage** ahora recibe además de las fotos, N mini-Excels
   (uno por dupla) en `rendiciones-excels/<YYYY-MM-DD>/<email>__<tipo>.xlsx`.
   Son públicos por URL. El script los sube en cada corrida.
2. **TablaGastos** tiene una columna nueva `Excel Dupla URL` con el link al
   xlsx filtrado de esa dupla.
3. **Flow Power Automate** — en el Apply to each del step 5, después de las
   fotos, se hace:
   - HTTP GET a `item()?['Excel Dupla URL']`
   - SharePoint Add attachment con el binario, filename
     `Rendiciones_<vendedor>_<tipo>.xlsx`.
4. El paso 5d viejo (adjuntar Excel maestro del OneDrive) se **elimina** o
   se convierte en 5e opcional (solo primer item si querés dejarlo como
   resumen general).

### Testing sin ensuciar SharePoint

Correr `FORCE_SEND=true` + `SKIP_MARK=true` desde GitHub Actions Run workflow.
El mail se manda pero:
- Ninguna rendición se marca como `notifiedAt` → el próximo cron las vuelve a mandar.
- El flow crea items nuevos en SharePoint — testear en un **List de sandbox**
  (temporalmente cambiar el "Site" del step Create item + Add attachment) o
  borrar los items de testing después.

### Rollback v3 → v2

Si el HTTP GET falla masivamente (Storage rules mal, URL corrupta, etc.), el
flow puede volver al comportamiento v2 así:
- Deshabilitar el paso 5d.1 (HTTP) y 5d.2 (Add attachment del Excel dupla).
- Re-habilitar el step viejo de "adjuntar Excel completo del OneDrive".
El Python sigue generando la columna `Excel Dupla URL` (no rompe nada
que el flow la ignore).

---

## Extensión v3 — bloque de solicitudes (2026-07-29)

El flow v2 solo procesaba `TablaGastos`. Las solicitudes de anticipo/recarga
(hoja `Solicitudes` del Excel, tabla `TablaSolicitudes`) se ignoraban → no
llegaban a SharePoint. Fix en v3: agregar un bloque paralelo al final del
`For each` de attachments.

### Estructura agregada

Después del `For each 1` (que procesa `TablaGastos`), al mismo nivel:

```
List rows Solicitudes         (Excel Online, Table = TablaSolicitudes)
Apply to each Solicitud       (input: body/value del List rows Solicitudes)
└── Create item 1             (SharePoint List = ANTICIPO Y RENDICION DE GASTO)
```

### Create item 1 — mapeo de campos

Usar SIEMPRE `items('Apply_to_each_Solicitud')?['<campo>']` (nombre exacto
del step Apply to each). NO usar `item()` — puede resolver mal si Power
Automate detecta ambigüedad de scope.

| Campo SharePoint | Expression |
|---|---|
| `Title` (Indicar el motivo...) | `concat(items('Apply_to_each_Solicitud')?['Vendedor (email)'], ' \| ', items('Apply_to_each_Solicitud')?['Tipo operacion'], ' \| ', items('Apply_to_each_Solicitud')?['ID'])` |
| `Solicitado por Claims` | `items('Apply_to_each_Solicitud')?['Vendedor (email)']` |
| `Tipo de Operacion Value` | `if(equals(items('Apply_to_each_Solicitud')?['Tipo operacion'], 'RECARGA'), 'Recarga', if(equals(items('Apply_to_each_Solicitud')?['Tipo operacion'], 'ANTICIPO DE EFECTIVO'), 'Anticipo en efectivo', 'Rendicion de Gasto'))` |
| `Moneda Value` | `if(equals(items('Apply_to_each_Solicitud')?['Moneda'], 'PESOS ARGENTINOS'), 'PESOS', if(equals(items('Apply_to_each_Solicitud')?['Moneda'], 'DOLARES'), 'DOLARES', 'OTRAS MONEDAS'))` |
| `Importe` | `items('Apply_to_each_Solicitud')?['Importe']` |
| `Comentarios` | `concat('Motivo: ', items('Apply_to_each_Solicitud')?['Motivo'], if(empty(items('Apply_to_each_Solicitud')?['Observaciones']), '', concat(' — Obs: ', items('Apply_to_each_Solicitud')?['Observaciones'])))` |
| `Rendiciones IDs` | `items('Apply_to_each_Solicitud')?['ID']` |
| `Cant rendiciones` | `1` |
| `Desde` / `Hasta` | `items('Apply_to_each_Solicitud')?['Fecha aprobacion']` |
| `Estado Value` | `Abierto` (default) |
| `Registrado` | `No` |
| `SAP Value` | `No Registrado` |
| `Tipo de gasto Value` | vacío (no aplica) |
| `Tipo comprobante Value` | vacío (no aplica) |

Valores válidos de `Tipo operacion` en el Excel (viene del dropdown de la app en
`index.html` línea ~2951): `ANTICIPO DE EFECTIVO`, `RENDICION DE GASTO`,
`RECARGA`. El `if()` los mapea a las 3 opciones del dropdown SharePoint:
`Anticipo en efectivo`, `Rendicion de Gasto`, `Recarga`.

### Configure run after — CRÍTICO

Cuando un mail tiene solo gastos o solo solicitudes, una de las 2 tablas no
existe en el Excel → `List rows` falla con `NotFound`. Sin configuración
tolerante, el flow entero se detiene. Fix:

1. **List rows present in a table** (Gastos): Settings → Run after (parent:
   `Create file`) → marcar `is successful + has failed + is skipped`.
2. **List rows Solicitudes**: Settings → Run after (parent: `List rows present
   in a table` que es el de Gastos) → marcar `is successful + has failed +
   is skipped`.
3. **Apply to each Solicitud**: Settings → Run after (parent: `For each 1`) →
   marcar `is successful + has failed + is skipped`. El `For each 1` puede
   fallar por `ExpressionEvaluationFailed` si `List rows Gastos` devolvió
   null; el Apply to each Solicitud debe correr igual.

### Error común: "cannot reference action 'Create_item'"

Si al guardar el flow aparece:

```
InvalidTemplate: 'Create_item_1' cannot reference action 'Create_item'.
The action 'Create_item' is nested in a foreach scope of multiple levels.
Referencing repetition actions from outside the scope is supported only
when there are no multiple levels of nesting.
```

Causa: algún campo del `Create item 1` (solicitudes) referencia
`outputs('Create_item')` — el Create item de gastos que está anidado
profundamente en `For each attachments → For each 1 → Apply to each → Condition`.

Fix: abrir el `Create item 1` → tab **Code view** → buscar `Create_item`
(sin `_1`). Reemplazar por `items('Apply_to_each_Solicitud')?['<campo>']`.
Típico culpable: el campo `Importe` (si se agregó desde Dynamic content
picker cuando el step estaba dentro del scope de gastos, quedó apuntando al
Create item viejo).

### Nombre único del archivo Excel

Cambiar el step **Create file** — campo `File Name` de `rendiciones-temp.xlsx`
(fijo) a expression:

```
concat('rendiciones-', utcNow('yyyy-MM-dd-HHmmssfff'), '.xlsx')
```

Genera nombres tipo `rendiciones-2026-07-29-153042123.xlsx` — únicos por
milisegundo. Previene el error `Create_file failed: file is locked for shared
use` cuando el user tiene Excel abierto en Desktop / Online / Teams.

Al hacer este cambio, actualizar el step **List rows present in a table**
para que en `File` use dynamic content `Id` del Create file (no un path
hardcoded).

### Filename del attachment SharePoint

Para que cada item tenga el Excel con un nombre útil:

```
concat('Rendiciones_', item()?['Vendedor (email)'], '_', replace(replace(item()?['Tipo gasto'], ' ', '_'), '/', '_'), '.xlsx')
```

Los `replace()` sanitizan espacios y `/` que SharePoint rechaza en filenames.

### Reference log de troubleshooting v3 (2026-07-29)

Durante la implementación del v3 surgieron estos issues, todos resueltos:

1. **File lock `rendiciones-temp.xlsx`**: solucionado con nombre único
   (`utcNow`).
2. **502 BadGateway en List rows**: mismo root cause del file lock — la
   solución del nombre único lo resuelve también.
3. **Schema caché**: Power Automate a veces no ve las columnas nuevas del
   Excel en Dynamic content (queda cacheado con schema viejo). Fix: usar
   expression manual `item()?['Excel Dupla URL']` en vez de token.
4. **Apply to each Solicitud creado en scope incorrecto**: al agregar el
   step, Power Automate lo puso adentro del Apply to each de gastos (después
   del Condition). Fix: cortar (`Cut to my clipboard`) y pegar al mismo nivel
   del For each 1 (fuera de él).
5. **`For each 1` failed por null**: cuando `List rows Gastos` falla,
   `body/value` es null → `For each 1` no puede iterar. Se resolvió con
   Configure run after tolerante en Apply to each Solicitud.
6. **`Create_item` reference error**: el Importe del Create item 1 quedó
   apuntando al Create item de gastos (`outputs('Create_item')`) tras el
   Cut & Paste. Reemplazar por `items('Apply_to_each_Solicitud')?['Importe']`.

---

## FAQ futura

- **"Quiero ver el detalle de una dupla en SharePoint"**: cada item tiene
  el campo `Rendiciones IDs` con los IDs de Firestore separados por `;`.
  Esos IDs son las claves de la collection `rendiciones` y se pueden ver
  en la app desde Admin → Rendiciones.

- **"Falta una rendición en SharePoint"**: chequear en el Excel la hoja
  "Detalle" si el gasto aparece ahí. Si no aparece, no estaba `approved` o
  ya había sido notificada antes (ver `notifiedAt` en Firestore).

- **"Quiero recibir las rendiciones de un solo día"**: en GitHub Actions →
  Run workflow → poner `FORCE_SEND=true` y `SKIP_MARK=true` (test).
