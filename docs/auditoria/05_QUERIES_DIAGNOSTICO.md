# E5 — Queries de diagnóstico contra prod

> **GATE HUMANO:** las queries contra prod requieren OK explícito de Mariano antes de ejecutar `--prod`. Los `--dry-run` (default) ya pasaron.

## Scripts

| Script | Hipótesis | Objetivo |
|--------|-----------|----------|
| `scripts/audit/A_reservas_vivas_pedido_enviado.cjs` | H2 | Reservas vivas (ASIG/confirmed) con pedido ya enviado a SAP |
| `scripts/audit/B_bo_con_fisico_positivo.cjs` | H6-adyacente, FINDING-05 | SKUs en backorderBySkuApp con Físico dep 11 > 0 que NO están en ingresos_reparto activo |
| `scripts/audit/C_pedidos_bo_con_stock_al_crear.cjs` | H1 (confirmada) | Pedidos ex-ASIG con 100% BO + `app_only` — víctimas directas del bug |

Todos aceptan:
- `--dry-run` (default): imprime estrategia y query lógica sin tocar red.
- `--prod`: ejecuta contra `app-vendedores-shimano` usando ADC (`gcloud auth application-default login` o `GOOGLE_APPLICATION_CREDENTIALS`).

## Resultado dry-run (ejecutado 2026-10-20)

Los 3 scripts imprimen la estrategia + query lógica. Sin side effects. Gate `--dry-run` verde.

## GATE HUMANO para `--prod`

**STOP.** Antes de correr `--prod`:

1. Mariano debe confirmar que quiere las queries en prod ahora.
2. Verificar `gcloud auth application-default login` activo.
3. Preferir ventana baja (fuera de peak del CRM).

**Pedido explícito a Mariano:** ¿Autorizás ejecutar las 3 queries (`--prod`) contra `app-vendedores-shimano`? Son read-only, sin side effects, pero pueden costar lecturas Firestore.

Si OK → ejecutar en orden A → B → C y pegar la salida en este archivo.

## Qué esperar

- **Query A > 0**: reservas fantasma (bug H2 real end-to-end). Hay 3 caminos para resolver una reserva — si alguno falla, queda viva. Mide la magnitud.
- **Query B > 0**: SKUs con BO colgado + stock físico libre. Impacto operativo del gap FINDING-05.
- **Query C > 0**: dimensión del bug H1 en prod. Cada pedido es evidencia histórica. **Esperado alto** (bug vive desde v1208 2026-10-08).

## Scripts complementarios existentes (para referencia)

- `scripts/audit_backorder_overlap.py` — detector STRICT/LOOSE de duplicación BO (precedente 2026-10-05).
- `scripts/audit_backorder_overlap_adc.py` — wrapper ADC del anterior.
- `scripts/audit_bo_vs_facturado.py` — audit BO vs facturado 2026-10-14.
- `scripts/audit-waitlist-integrity.cjs` — integridad waitlist.

## Gate E5

- 3 scripts creados ✅
- Dry-run corre sin errores ✅
- Scripts imprimen la query lógica antes de ejecutar ✅
- Prod bloqueado por `--prod` flag + aviso GATE HUMANO ✅

**GATE_E5_OK para dry-run.** Prod pendiente de OK de Mariano.
