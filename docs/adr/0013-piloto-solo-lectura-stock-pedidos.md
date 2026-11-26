# ADR-0013: Piloto frontend-new — solo-lectura Stock + Pedidos

- **Status**: Accepted (2026-11-26).
- **Decididores**: Mariano (owner técnico).
- **Relacionado**: ADR-004 (stack frontend), ADR-015 (CWV mobile-first).

## Contexto

El frontend nuevo (ADR-004) tiene que empezar con un scope acotado para validar el stack + el workflow convivencia sin exponer riesgo de negocio. El CRM legacy sigue manejando toda la operación (envío a SAP, reparto, ASIG, waitlist, etc.). Si el piloto agrega escrituras, duplicamos riesgo + requiere sincronización de rules + gates server-side.

## Decisión

El piloto abre **2 pantallas solo-lectura** bajo `/app2/`:

1. **`/app2/stock`** — vista del breakdown por SKU (fuente: `getStockBreakdown` del backend nuevo, que a su vez lee `app_config/stock_snapshot` + pedidos). Sin acción de escritura.
2. **`/app2/pedidos`** — lista de pedidos del vendedor (query filtrada por `assignedVendorUid`). Sin acción de escritura.

Características:

- Solo `GET` a los endpoints del backend-new.
- Sin modales de confirmación / edición / borrado.
- Sin integración con el flow de commit SAP ni con `releaseAsigCF`.
- Auth via Firebase Auth (mismo project que el legacy).

### Lo que NO entra en el piloto (hasta aprobación explícita)

- Crear pedido / pasar a pendiente / confirmar.
- Editar lista de espera / unificar órdenes.
- Flows CPST / Reparto / Backorder.
- Admin tabs (users, vendor_overrides, etc.).
- Dashboard de ventas.

Estos siguen en el CRM legacy sin cambio.

## Consecuencias

### Positivas

- Riesgo mínimo: si el frontend nuevo tiene un bug, el vendedor abre `/` y sigue trabajando.
- Validamos el stack (ADR-004) con carga real (los vendedores van a consultar stock + pedidos muchas veces por día).
- Tenemos baseline CWV real (ADR-015) de las 2 pantallas más consultadas.

### Negativas

- No valida los flows críticos (commit SAP, reparto, waitlist). Esos quedan sin cobertura del nuevo frontend.
- Mantener 2 frontends duplica la superficie de UI "stock" + "pedidos" durante el piloto (riesgo de drift visual).

## Verificación

- `frontend-new/tests/e2e/smoke.spec.ts` valida que las 2 pantallas cargan sin errores + nav funciona.
- Post-P1.6: lighthouse-ci sobre las 2 rutas valida targets de ADR-015.

## Referencias

- ADR-004 — stack decisión.
- ADR-015 — CWV mobile-first.
