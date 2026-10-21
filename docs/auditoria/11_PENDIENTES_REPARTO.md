# E8 — Pendientes de reparto (SKUs con BO + Físico > 0 fuera de ingresos_reparto activo)

**Fuente:** Query B del 2026-10-20 (`scripts/audit/B_bo_con_fisico_positivo.cjs --prod`) + cross-check de clientes por SKU (`scripts/audit/_pendientes_reparto_bo_clientes.cjs`).
**Para:** Pablo (debe entrar al modal Reparto y asignar manualmente).
**Gap operativo documentado:** FINDING-05 (ver `01_MAPA_FLUJO.md`).

## Resumen

- **14 SKUs** con stock físico dep 11 > 0 y BO pendientes.
- **2 SKUs no tienen BO vivo dentro del TTL 7d** (BO viejos o ya canceled): `SGS80MH2A`, `STS66MH2C`.
- **12 SKUs con reparto pendiente real** y clientes en espera.

## Tabla por SKU

| SKU | Físico dep 11 | BO total (dentro TTL 7d) | Clientes en espera |
|-----|-------------:|------------------------:|-------------------:|
| EXGTVS90M4CH | 8 | 3u | 2 |
| ALV6000FA | 5 | 5u | 4 (incluye víctima H1 SNAKE S.R.L.) |
| SGS80MH2A | 4 | 0u | 0 (BO vencido) |
| CLS70MH2PY | 4 | 2u | 1 |
| 21100150150W | 4 | 1u | 1 |
| SUNBASS | 3 | 20u | 4 |
| SHMTECHLGREYXL | 2 | 4u | 2 |
| CLS70XH2CH | 2 | 6u | 3 |
| NEXS70H2SACH | 2 | 14u | 6 |
| EXGC70XHBAR | 2 | 12u | 10 |
| ECLIPSE | 2 | 23u | 4 |
| STS66MH2C | 1 | 0u | 0 (BO vencido) |
| CU301HGK | 1 | 27u | 10 |
| FXXTR27XH | 1 | 4u | 2 |

## Clientes en espera por SKU (FIFO)

### EXGTVS90M4CH (físico 8)
- RAUL EDUARDO DELL ACQUA (C20080033614) — 2u — 2026-10-14 (7d)
- IGNACIO EZEQUIEL ANTONINI (C20346524775) — 1u — 2026-10-15 (5d)

### ALV6000FA (físico 5) — incluye víctima H1
- RAUL EDUARDO DELL ACQUA (C20080033614) — 2u — 2026-10-14 (7d)
- MARIA VERONICA IERONIMO (C27224110362) — 1u — 2026-10-16 (4d)
- **SNAKE S.R.L. (C30719034914)** — 1u — 2026-10-19 (1d) ← **víctima H1, se repara con script D post-apply**
- LA LOMITA OUTDOORS SRL (C30716659379) — 1u — 2026-10-20 (1d)

### CLS70MH2PY (físico 4)
- LA LOMITA OUTDOORS SRL (C30716659379) — 2u — 2026-10-20 (1d)

### 21100150150W (físico 4)
- FERNANDO LUIS HORACIO DEL INTENTO (C23256905159) — 1u — 2026-10-20 (1d)

### SUNBASS (físico 3)
- MUNDO ESTURION S.R.L. (C33716739649) — 10u — 2026-10-19 (1d)
- BROBRO SA (C30718510291) — 3u — 2026-10-19 (1d)
- SNAKE S.R.L. (C30719034914) — 3u — 2026-10-20 (0d)
- FRANCISCO JOSE ARIEL BOVA (C20269166380) — 4u — 2026-10-20 (0d)

### SHMTECHLGREYXL (físico 2)
- ANDREA ROGELIA TRENTIN (C27200624179) — 2u — 2026-10-19 (1d)
- LA LOMITA OUTDOORS SRL (C30716659379) — 2u — 2026-10-20 (1d)

### CLS70XH2CH (físico 2)
- COMERCIAL 4 NARICES S.A. (C30718204905) — 2u — 2026-10-17 (3d)
- LA LOMITA OUTDOORS SRL (C30716659379) — 2u — 2026-10-20 (1d)
- FERNANDO LUIS HORACIO DEL INTENTO (C23256905159) — 2u — 2026-10-20 (1d)

### NEXS70H2SACH (físico 2)
- GUSTAVO EMILIO DESIATA (C20250448555) — 2u — 2026-10-14 (6d)
- REBORN SRL (C30710852762) — 6u — 2026-10-15 (5d)
- JUAN MANUEL SULIMAN (C20328639654) — 1u — 2026-10-16 (4d)
- CARLOS ALBERTO MAMANI (C20444448130) — 2u — 2026-10-16 (4d)
- SNAKE S.R.L. (C30719034914) — 2u — 2026-10-20 (0d)
- OSVALDO RUBEN MASERA (C20131936444) — 1u — 2026-10-20 (0d)

### EXGC70XHBAR (físico 2)
- SUSANA GRACIELA ANDRILI (C27064094683) — 1u — 2026-10-14 (7d)
- IGNACIO EZEQUIEL ANTONINI (C20346524775) — 1u — 2026-10-15 (5d)
- MARIA VERONICA IERONIMO (C27224110362) — 1u — 2026-10-16 (4d)
- SEBASTIAN LUIS VILLARREAL (C20305655814) — 1u — 2026-10-16 (4d)
- MARCELA CAPORIZZO (C23209480034) — 1u — 2026-10-17 (3d)
- MUNDO ESTURION S.R.L. (C33716739649) — 2u — 2026-10-19 (1d)
- LA LOMITA OUTDOORS SRL (C30716659379) — 1u — 2026-10-20 (1d)
- FERNANDO LUIS HORACIO DEL INTENTO (C23256905159) — 1u — 2026-10-20 (1d)
- FRANCISCO JOSE ARIEL BOVA (C20269166380) — 2u — 2026-10-20 (0d)
- OSVALDO RUBEN MASERA (C20131936444) — 1u — 2026-10-20 (0d)

### ECLIPSE (físico 2)
- ANDREA ROGELIA TRENTIN (C27200624179) — 10u — 2026-10-19 (1d)
- MUNDO ESTURION S.R.L. (C33716739649) — 9u — 2026-10-19 (1d)
- PESCAR.INFO SHOP S.R.L. (C30711930392) — 2u — 2026-10-20 (0d)
- FRANCISCO JOSE ARIEL BOVA (C20269166380) — 2u — 2026-10-20 (0d)

### CU301HGK (físico 1)
- PESCAR.INFO SHOP S.R.L. (C30711930392) — 6u — 2026-10-14 (7d)
- RAUL EDUARDO DELL ACQUA (C20080033614) — 3u — 2026-10-14 (7d)
- ESTEBAN GABRIEL QUESADA (C20224147342) — 2u — 2026-10-15 (5d)
- REBORN SRL (C30710852762) — 6u — 2026-10-15 (5d)
- SUSANA GRACIELA ANDRILI (C27064094683) — 2u — 2026-10-15 (5d)
- MARIA VERONICA IERONIMO (C27224110362) — 1u — 2026-10-16 (4d)
- FEDERICO ORLANDO RODRIGUEZ (C20254802019) — 1u — 2026-10-16 (4d)
- COMERCIAL 4 NARICES S.A. (C30718204905) — 1u — 2026-10-17 (3d)
- MARCELA CAPORIZZO (C23209480034) — 1u — 2026-10-17 (3d)
- MUNDO ESTURION S.R.L. (C33716739649) — 4u — 2026-10-19 (1d)

### FXXTR27XH (físico 1)
- MARCELO ALEJANDRO DEIS (C20170512252) — 2u — 2026-10-15 (5d)
- SNAKE S.R.L. (C30719034914) — 2u — 2026-10-20 (0d)

## Qué hacer

Pablo abre el modal Reparto (navbar → Reparto) y asigna manualmente. Los `ingresos_reparto` activos **no** incluyen estos SKUs porque la CF `onDep11IncreaseCreateReparto` solo dispara en **delta positivo** del dep 11 (ver FINDING-05). Si el stock llegó antes del BO o la CF `status='done'` quedó marcada con stock sobrante, el SKU no aparece en Reparto.

**Fix estructural (fuera de esta tarea):** propuesta P5 en `06_PROPUESTAS_FIX.md`.

## Notas

- ALV6000FA incluye a SNAKE S.R.L. como víctima H1 — el script D del fix la restaura a ASIG post-deploy. Pablo verá su ASIG viva y podrá crear pedido ST sin repartir manualmente.
- Varios clientes tienen BO en múltiples SKUs (ej. LA LOMITA OUTDOORS SRL en 5 SKUs) — considerar atacar por cliente, no por SKU.
