# Fix: `resolveClientVendorServerSide` lee `client_master` + `vendor_overrides` (2026-11-25)

Hotfix al gate `INTERNO_CLIENTE_FUERA_DE_PAREJA` introducido por PR #1428 (v1577, §Decisión 1). Solo cambia `functions/core/resolve-client-vendor-core.js` y agrega tests.

## Antes

`resolveClientVendorServerSide` server-side resolvía el vendedor de un cliente leyendo dos fuentes:

1. `roles` (todos los roles — hotfix 2026-10-29).
2. `client_applications where status='approved'` (approvedAltas).

El server **no** leía `client_master` ni `vendor_overrides`.

## Problema

Mariano reportó 2026-11-25 que los VDI eran rechazados con `INTERNO_CLIENTE_FUERA_DE_PAREJA` al confirmar pedidos propios. Diagnóstico:

- Un cliente puede quedar asignado a un VDE via tres caminos (CLAUDE.md §102): OCRD base → `vendor_overrides` (SHOP/LOC/PROV) → `client_applications.assignedVendor` para altas SAP.
- La UI "Master Clientes" + "Reasignar Zonas" escriben `vendor_overrides` para los dos primeros caminos y `client_applications.assignedVendor` para altas (cubierto). `client_master.vendor` guarda además el vendor cacheado del POINT original cuando se sincroniza SAP (`master-clientes.js:879`).
- El server no leía ni `client_master` ni `vendor_overrides`, entonces un cliente asignado a un VDE via POINT o Zonas que no estaba en `approvedAltas` quedaba sin resolución → `resolveClientVendorFromMaster` devolvía `cliente_no_en_master`.
- El gate del interno en `commit-pedido-core.js:380-520` (PR #1428) permite pasar si el cliente devuelve `cliente_no_en_master` o `input_vacio` (hipótesis "cliente huérfano"). Si el helper devuelve otro vendorUid (cliente efectivamente asignado a otro VDE según `client_applications`), el gate rechaza con `cliente_de_otra_pareja`.

El caso reportado implica un cliente donde el servidor resolvía incorrectamente (via `approvedAltas` a otro VDE o quedaba sin resolver a la pareja real del VDI). Sin leer `vendor_overrides` + `client_master`, el servidor no reflejaba las reasignaciones hechas via Zonas ni el vendor del POINT.

## Cambio

Nuevo PASO 2.5 en `resolveClientVendorServerSide` (antes del pure que lee `approvedAltas`). Lee:

- `client_master` filtrado por `sapCardCode == cardCode` (fallback `clientName`) con `.limit(1)`.
- `vendor_overrides` (toda la colección — pocos docs).

Aplica precedencia §102:

1. Override `scope='shop'` con `clientName` match.
2. Override `scope='loc'` con `province` + `locName` match.
3. Override `scope='prov'` con `province` match.
4. `client_master.vendor` (cache del POINT; mejor aproximación sin POINTS inline).

Si alguna de las 4 fuentes resuelve → normaliza vendorKey (label "Z<N> - Nombre" → "NOMBRE") → busca UID en `users` → retorna `resolved: true, source: 'override_shop'|'override_loc'|'override_prov'|'client_master'`.

Si ninguna resuelve o el `vendorKey` resuelve a `__DISTRIBUTOR__` → fallthrough al PASO 3 (pure con `approvedAltas`) que preserva el comportamiento histórico. La firma del retorno es idéntica.

## Por qué

- Alinea el server con CLAUDE.md §102 (cadena autoritativa `OCRD → vendor_overrides → client_applications`).
- CLAUDE.md §89: cualquier gate server que rechaza debe poder resolver el dato por sí mismo. El gate `INTERNO_CLIENTE_FUERA_DE_PAREJA` usa el vendor del cliente; ahora el server lo resuelve de la misma forma que lo hace la UI (POINTS + overrides + altas).
- CLAUDE.md §57: `resolveClientVendorServerSide` es server-only (no tiene mirror en `src/pure/`). La modificación no requiere espejo client.
- Preserva fail-open: si `client_master` no tiene el cliente, si `vendor_overrides` falla por network, o si no hay match en users, cae al pure actual con la lógica histórica.

## Verificación

- `npx vitest run tests/functions/resolve-vendor-clientmaster-overrides-v1582.test.js` → 10 tests PASS cubren los 4 niveles de precedencia + fallthrough + `__DISTRIBUTOR__` + label histórico "Z5 - X" + lookup por `clientName` + repro caso Mariano (override_loc que gana al client_master.vendor cacheado).
- `npx vitest run tests/functions/resolve-vendor-uid-roles.test.js tests/functions/commit-pedido-vendor-uid-server-resolve-v1491.test.js` → 15 tests PASS (sin regresiones en los tests existentes del helper + el gate `VENDOR_UID_MISSING`).
- `npx biome check functions/core/resolve-client-vendor-core.js` → clean.

Tests que no corren en este fix (preexistentes, no relacionados): 4 emulator tests + 5 tests de `dashboard-ventas` que fallan en main también.

## Rollback

`git revert <sha>` de este commit. El revert del bloque PASO 2.5 vuelve el helper al comportamiento previo (solo `approvedAltas` + `roles`). El gate `INTERNO_CLIENTE_FUERA_DE_PAREJA` vuelve a aplicar la lógica de pre-#1582.

## Deploy

`firebase deploy --only functions:commitPedidoCF` (único consumer del helper vía `resolveClientVendorServerSide`). El trigger `onPedidoConfirmedSendToSap` también podría invocarlo si se extiende, pero hoy solo `commit-pedido-core.js` lo llama.

## Observaciones operativas

- La lectura de `vendor_overrides` es una query sin filtro (toda la colección). En prod hay <100 docs; el costo es trivial. Si la colección crece a >1k docs, considerar filtros server-side por scope/province.
- La lectura de `client_master` usa `.limit(1)` por `sapCardCode` o `clientName`. Si hay duplicados en `client_master` con mismo `sapCardCode`, se toma uno arbitrario — alinear con la data real del master donde cada cliente tiene un solo doc.
- El fix NO actualiza el payload que envía el cliente. El cliente sigue resolviendo con su cache local (POINTS + vendor_overrides + approvedAltas) y el servidor re-resuelve con autoridad.
