# E8 — Histórico de víctimas H1 sin filtro TTL

**Script:** `scripts/audit/C2_historico_h1_sin_ttl.cjs`
**Fecha de query:** 2026-10-20 21:45 UTC-3.
**Ventana:** `createdAt >= 2026-10-08T00:00:00Z` (release del bug v1208) hasta hoy.

## Resultado

```
Pedidos ex-ASIG 100% BO + app_only desde v1208: 1
  2026-10-19T19:21:06.278Z / tcWxGCE1rdCZz2Iw56Ex / SNAKE S.R.L. (C30719034914) / 1u / ALV6000FA:1
```

**Total histórico: 1 víctima.** Es la misma que ya conocíamos.

## Nota de interpretación

Mariano asumió en el prompt que Query C original filtraba por TTL. **No lo hace**: Query C filtra por `qtyOpen > 0` + 100% líneas BO + `transferidoSAP.via='app_only'` + `source='stock-asignado-batch'`. No tiene filtro de edad.

Query C2 agrega filtro explícito `createdAt >= 2026-10-08` (release del bug) y verifica que no haya víctimas detectadas por Query C que hayan sido excluidas por error.

**Explicación del "parece 1 porque filtra por TTL"**: la línea BO del pedido víctima tiene edad 1 día (del 19/10 al 20/10). Está dentro del TTL 7d. Si hubiera víctimas de hace >7d que se hubieran "borrado" de Query C por TTL, aparecerían acá. Pero no aparecen porque Query C no filtra por edad del pedido — solo por `qtyOpen > 0`.

## Víctimas con ASIG original ya vencida (manejo manual por Pablo)

**N/A — 0 casos.** La única víctima (`tcWxGCE1rdCZz2Iw56Ex`) tiene ASIG original (`mSuIidbMd74ziEMIBPUC` lineIndex 78) con `asigAt='2026-10-16T21:47:26.763Z'`. Edad: ~4 días. **Dentro del TTL 7d. Recuperable.**

## Si en el futuro aparecen víctimas con ASIG vencida

El script D (`scripts/audit/D_restaurar_victimas_h1.cjs`) ya detecta esto y las clasifica como **Caso B (no-recuperable)**: deja el pedido B en BO con flag `h1_victim`. Pablo decide manualmente qué hacer (facturar manualmente desde SAP, dar de baja el pedido, crear nuevo CPST, etc).

**Para pedir el caso a Pablo**: enumerar víctimas Caso B en este archivo con cliente, SKU, qty, fecha, y copiar/pasar al Slack de operaciones.
