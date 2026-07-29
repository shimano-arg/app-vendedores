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
