# Lote de seguridad de reglas — 2026-11-24

Rama `sec/rules-batch-2026-11-24`, desde `main` en `fb4f1aa`. Toca `firestore.rules`, `storage.rules`, tests de reglas y dos scripts de auditoría. No toca `functions/`, `index.html`, `src/` ni lockfiles.

## Antes

- Varias colecciones aceptaban cambios del navegador con permisos más amplios que lo que la app usa: campos editables sin lista cerrada, lecturas abiertas a cualquier cuenta logueada (incluso sin rol aprobado) y un alta pública de clientes sin límites de forma.
- Había seis PRs de hardening abiertos por separado (#1375, #1376, #1377, #1379, #1380, #1381, #1398, #1401), algunos con ajustes pendientes del análisis.

## Problema

- Un usuario con sesión podía escribir en documentos campos que la app nunca escribe desde ese rol.
- Datos de configuración y estadísticas eran legibles por cuentas sin rol aprobado.
- El formulario público de alta aceptaba cualquier forma de documento.
- Aplicar los PRs uno por uno, sin probarlos juntos, arriesgaba romper flujos reales de vendedores.

## Cambio

Un commit por PR o ajuste:

| Commit | Qué |
|---|---|
| #1377 | Colección de locks de lista de espera cerrada al navegador (solo servidor). Scripts de auditoría W/Y. **No entra** el workflow de GitHub Actions del PR. |
| #1401 | El vendedor no edita el descuento de un pedido ya existente. |
| #1376 | Lista cerrada de campos editables en `revision_waitlist.update`. |
| #1398 (parte) | `isMariano` tolerante a token sin email; freeze de campos sensibles en `roles.update`; `status` válido al crear altas con login (incluye el alta rápida del vendedor, que nace aprobada con SAP pendiente). **No entran**: lista cerrada de `client_applications.update`, cambios de `client_master`, validación de formato de cardCode, cierre de `google_maps`, y las partes de `functions/`. |
| #1375 (ajustado) | Lista cerrada de campos para el VDI en `pedidos.update`, sin descuento. `transferidoSAP` solo puede tocarse desde el navegador para la marca "solo en la app". |
| #1379 (ajustado) | Crear pedidos directo desde el navegador queda solo para admin/gerente. Verificado por grep: el único `pedidos.add` del cliente está en código muerto; los pedidos se crean por Cloud Function. |
| #1380 (ajustado) | Lista cerrada de campos en avisos (`notifications`), con los campos que la app sí usa (`applicationId`, `comercio`, `images`, `targetName`). |
| #1381 (ajustado) | Lista cerrada de campos y tipos en `operations_log`, con `firebaseCode`, `skus`, `exportKind`, `error` y el tipo `export_failed`. |
| Ajuste #1376 | `sourceExcelPath` y `sourceExcelName` en la lista de `revision_waitlist.update` (la carga por Excel los guarda). |
| Lote B | `client_buyer_stats`, `app_config/planner_config` y `app_config/feature_flags`: lectura solo con rol aprobado. `allowed_emails`: rol aprobado, o el doc del propio email (el login lo lee antes de tener rol). Storage `waitlist-excels`: lee el dueño con rol y admin/gerente/interno. |
| C-01 | Alta pública de clientes: lista cerrada de campos, tipos y largos, estado fijo, sin vendedor ni aprobaciones, adjuntos acotados en tamaño y formato. |
| H10 | Al crear su propio doc de rol, el email debe ser el del token. |
| Tests | Permitido y denegado por cada cambio, más los flujos reales. |

Desvíos respecto del pedido original:

- **Adjuntos del alta pública**: se aceptan data URI de imagen o PDF (máx. ~1,4 MB por campo) además de URLs de Storage. El formulario actual guarda los adjuntos como data URI; exigir solo https rompería el alta.
- **`allowed_emails`**: excepción para leer el doc del propio email sin rol, porque el chequeo de acceso del login corre antes de asignar rol.
- **Alta rápida**: puede nacer `approved` sin admin, solo si es `source='alta_rapida'` con `manualSapPending=true`, que es lo que hace la app.
- **Campos agregados por inventario**: `sourceExcelPath`/`sourceExcelName` (#1376) y `export_failed` (#1381) no estaban en los PRs y la app los usa.

## Por qué

Cerrar lo que el navegador puede escribir o leer al mínimo que la app realmente usa, sin romper los flujos de vendedores. Cada lista de campos salió de un inventario de las escrituras reales en `index.html` y `src/`.

## Verificación

Emulador de Firestore + Storage, `vitest run tests/rules/ --fileParallelism=false`:

| | Fallan | Pasan | Skip | Total |
|---|---|---|---|---|
| `main` (fb4f1aa) | 5 | 249 | 5 | 259 |
| Esta rama | 4 | 388 | 7 | 399 |

- Los 4 que fallan son los mismos tests de `seguimiento_*` que ya fallaban en `main`. El quinto fallo de `main` (alta pública con CUIT con guiones) ahora pasa: se corrigió el dato del test.
- Los 2 skip nuevos son los casos "permitido" del test de Storage. En el entorno de prueba, el emulador de Storage devuelve null en `firestore.get()` aunque el doc de rol existe. Hay que correrlos en CI o local antes del deploy.
- Unit (`vitest run tests/unit`): 3102 pasan. Se ajustaron dos fixtures de `d8-deploy-state` al nuevo formato de `roles.update`.

## Deploy

```
firebase deploy --only firestore:rules,storage
```

Después del deploy, probar con un usuario vendedor real: confirmar un pedido, editar uno propio, cargar un Excel en lista de espera, un alta rápida y un alta desde el formulario público.

## Rollback

Volver a publicar las reglas de `fb4f1aa`:

```
git checkout fb4f1aa -- firestore.rules storage.rules
firebase deploy --only firestore:rules,storage
```

Ningún cambio toca datos, así que no hay nada más que revertir.
