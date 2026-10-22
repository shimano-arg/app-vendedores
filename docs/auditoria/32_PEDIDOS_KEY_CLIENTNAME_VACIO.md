# M — Barrido global pedidos con key/clientName vacíos @ 2026-10-22T20:39:20.783Z

Pedidos de **cualquier origen** con `key` vacía/malformada o `clientName` vacío.

## Hallazgo

- Total pedidos escaneados: **472**
- Pedidos broken: **0**

### Por origen


## Dry-run detalle

_(ninguno — todos los pedidos tienen key canónica y clientName)_




## Siguiente paso

**Nada que hacer.** Todos los pedidos pasan la validación key canónica + clientName.

Script: `scripts/audit/M_pedidos_key_o_clientname_vacio.cjs` (dry-run only).
