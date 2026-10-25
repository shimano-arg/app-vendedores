# Análisis previo: control del backorder inflado (entrada y salida)

**Fecha**: 2026-10-25
**Rama**: `plan-backorder-inflado`
**Autor**: análisis automático (Claude, previa autorización Mariano)
**Modo**: PLAN-ONLY. **No se implementa nada hasta OK Mariano.**

> **Nota de alcance (§31 CLAUDE.md)**: este documento es análisis + script
> esqueleto `--dry-run`. No modifica `src/`, `functions/`, `index.html`,
> `firestore.rules` ni nada de prod. Si encuentro un bug "oneliner" en el
> camino, queda documentado abajo, **no se arregla aquí**.

---

## 1. Problema (parafraseado del prompt)

El back order (BO) de un par **cliente + SKU** debe ser **un solo número**:
la demanda insatisfecha del cliente para ese SKU. Hoy ese invariante se
rompe por dos caminos distintos:

### 1.1. Entrada: el BO crece sin reconciliar

Cada carga nueva (Excel, alta manual, CPST, unificación §42/§42.2,
"Generar Backorder") **suma** cantidades sobre el BO existente en vez de
reemplazar o alertar al VDE.

**Caso típico Mariano**:
- Septiembre: cliente pide 20u de FX4000. No hay stock. BO = 20u.
- Octubre: cliente re-manda el mismo Excel con 20u (es su pedido vigente,
  no un pedido adicional).
- VDE carga el Excel. BO pasa a **40u**.
- El cliente sigue queriendo **20u**. El sistema sobrestima la demanda.

**Impacto operativo**:
- Pablo asigna 40u cuando ingresa stock, "sirviendo" 20u fantasma.
- Forecast de reposición se infla (base cola BO + histórico).
- Overbooking: cuando SAP factura 20u, quedan 20u BO vivos que no
  corresponden a nada real.

### 1.2. Salida: el BO no se descuenta al enviar a SAP

Cuando se envía a SAP X unidades de **cliente+SKU** que tiene Y en BO
(en el mismo pedido o en otro pedido abierto del mismo cliente), el BO
previo **no se cancela**. Queda como demanda viva aunque esas unidades ya
fueron entregadas por otro camino.

**Caso típico**:
- Cliente A tiene BO de 1u del SKU 1234 en ORDEN 500 (sept, sin stock).
- En octubre entra 1u. VDE confirma otro pedido (ORDEN 540) para cliente A
  con 1u del mismo 1234, lo envía a SAP, factura.
- ORDEN 500 sigue con BO=1u del SKU 1234. Falso.

El flow actual (`doConfirmPedido` + bloque `_origenesACancelar` v1280/§35)
**solo cancela ASIG propias respaldadas por `asigRefs`** del pedido CPST.
NO toca BO genérico del mismo cliente+SKU en otros pedidos abiertos del
mismo cliente.

---

## 2. Mapa preliminar de puntos de inflación / no-descuento

Los puntos los enumero por "camino" (código + flow). La **severidad
estimada** es provisoria — el script de medición los va a cuantificar.
Archivos y funciones son fuente de verdad (`index.html`,
`src/pure/*.js`, `functions/core/*.js`).

### 2.1. ENTRADA — puntos donde el BO puede inflarse

| # | Camino | Archivo:fn | Comportamiento HOY | Cómo infla | Severidad est. |
|---|---|---|---|---|---|
| E1 | **Importación Excel → waitlist** | `index.html:revisionDejarRecalculando` + `_createOrUnifyWaitlistPayload` | Si el cliente tiene orden abierta (§42), unifica apilando items. `mergeLinesFromOrders` (§56) **suma qty** por SKU. | Mismo Excel re-cargado duplica demanda. §56 fusiona *dentro* de la unificación pero NO contra BOs vivos en pedidos ya confirmados/pending del mismo cliente+SKU. | **ALTA** |
| E2 | **Alta manual de SKU en orden de espera** | `index.html:reviewDejarEnEspera` + `dedupeLinesByCode` (§56) | `dedupeLinesByCode` fusiona duplicados **dentro del items[]** antes de guardar. Pero NO contrasta contra BO ya vivo del cliente+SKU en pedidos `state='BO'` abiertos. | VDE agrega SKU por 2a vez al mismo cliente → BO del pedido existente queda, y el nuevo pedido-waitlist crea más BO futuro cuando se envíe. | **ALTA** |
| E3 | **Unificación §42/§42.2 (review guard)** | `src/pure/review-guard-unify.js:mergeWaitlistIntoOrderLines` | **Append puro, sin dedupe por SKU** (comentario explícito: "Mariano decide"). | Si la orden absorbida tiene SKU repetido con la target, quedan 2 líneas del mismo SKU dentro de la unificada → luego `dedupeLinesByCode` en `_createOrUnifyWaitlistPayload` las fusiona por sumatoria. Es BO inflado "legítimamente" por la fusión §56. | **MEDIA** (fusión §56 es parcial — resuelve dentro de 1 orden pero no contra BO vivo en otras) |
| E4 | **CPST (Crear Pedido Desde Stock Asignado)** | `index.html:_cpstConfirmar` + `_cpstBuildCache` (§47 paridad) | Arma items[] con `qtyAjustada=min(sk.qty, disp)` + genera waitlist. §40.5 revierte sobre-asignadas a BO en el pedido origen. | Si el cliente ya tenía BO del SKU en otra orden abierta antes del CPST, no se reconcilia. El CPST reserva su ASIG, pero el BO viejo sigue vivo. | **MEDIA** |
| E5 | **"Generar Backorder" manual** (`_gbConfirmar`) | `index.html:_gbConfirmar` | Crea pedido directo con `state='BO'` para cada línea. **No contrasta** contra BO vivo del cliente+SKU en otras órdenes. | VDE puede crear 2 "manual backorder" distintos para el mismo cliente+SKU en el mismo día → 2 BOs duplicados. | **ALTA** |
| E6 | **"Pasar a Pendientes" → split confirmed/BO** | `functions/core/commit-pedido-core.js:computePedidoLinesSplit` | Al confirmar, `qty - qtyConfirmed = qtyBO` crea una línea `state='BO'`. **No chequea** si ese cliente+SKU ya tiene BO vigente en otra orden. | Si el VDE confirma 2 pedidos del mismo cliente+SKU en poca ventana (stock parcial para ambos), ambos quedan con línea BO viva → BO duplicado para el mismo cliente+SKU. | **ALTA** |
| E7 | **Reversión ASIG → BO** (§40.5, §40.7, §40.11) | `functions/core/reparto-core.js:revertSobreAsignadas`, `_cpstConfirmar`, botón X waitlist | Línea ASIG sin respaldo físico vuelve a BO. Está bien diseñado (idempotente). | No infla *por sí mismo*, pero reinyecta BO sobre el cliente+SKU que puede ya tener BO vivo en otra orden. | **BAJA** (idempotencia + closedReason distintiva) |
| E8 | **Órdenes de venta creadas directo en SAP (fuera de la app)** | `functions/core/sync-sap-orders-core.js` (sync inverso) | Marca `pedido.transferidoSAP.orderDocEntry`. §40.8 hace que confirmed con orderDocEntry NO reserve. | No infla BO. **Riesgo potencial**: si un VDE carga en la app un pedido para cliente+SKU que ya tiene BO vigente en SAP (SQ huérfana histórica), el app no sabe de esa SQ → BO duplicado entre SAP y app. | **BAJA/MEDIA** |

### 2.2. SALIDA — puntos donde el BO no se descuenta

| # | Camino | Archivo:fn | Comportamiento HOY | Cómo no descuenta | Severidad est. |
|---|---|---|---|---|---|
| S1 | **Envío a SAP (commitPedidoCF + auto-send)** | `functions/core/commit-pedido-core.js` + `functions/core/auto-send-sap-core.js` | Al enviar X u del cliente+SKU, no busca BOs vivos del mismo par para cancelarlos. Solo cancela ASIG `asigRefs` apuntadas por `line.origen='stock-asignado'`. | Cliente tiene BO=1 en orden A + confirma pedido B con 1u mismo SKU → ORDEN A sigue con BO=1 viva aunque la demanda ya quedó cubierta por B. | **ALTA** (caso típico Mariano) |
| S2 | **Facturación SAP (sync inverso)** | `functions/core/invoice-sync-core.js` | Marca línea `invoiced` por match SKU+qty con factura SAP. **No cancela BOs** de otras órdenes del mismo cliente+SKU. | Idem S1 pero por el camino automático. | **ALTA** |
| S3 | **Reparto aplicado (BO → ASIG)** | `functions/core/reparto-core.js:applyRepartoManualCore` | §34 (deprecado) decía "muta BO en ASIG, no crea reserva". §40 actualiza: BO no reserva, ASIG sí. El reparto consume BO del cliente+SKU al que asigna. | No es inflación — es la transición natural BO → ASIG. **Riesgo**: si Pablo asigna 1u a cliente A por un BO de 1u en orden X, pero el mismo cliente tiene BO=1u en orden Y del mismo SKU, cuál se consume? Hoy se asigna a la línea BO target (manual) sin considerar otros BOs vivos del mismo par. | **MEDIA** (puede inflar si el reparto manual no toca BOs del mismo par en otras órdenes) |
| S4 | **Vencimiento 90d BO (§37)** | `src/pure/stock-realmente-disponible.js:lineReservesStock('BO')` | BO con `createdAt > 90d` deja de reservar. **Nunca** se cancela ni se marca cancelled. Sigue en Firestore como línea viva, solo que invisible al breakdown. | No infla reservas, pero sí infla la cola `backorderApp.porCliente` del breakdown (que no aplica TTL, solo lineReservesStock sí). → script de medición debe contar `line.state='BO' && createdAt > 90d && closedAt==null`. | **BAJA** (cosmético visual, no afecta reserva) |
| S5 | **Borrado / cancelación de orden** | §40.6 (cliente_rechazo_cpst), §40.7 (quitado/recorte vendedor), `releaseAsigCF` | Cancela ASIG del origen. **No toca BOs** derivados. | Si el cliente rechaza una orden que creó BO en pedidos previos (vía unificación), el BO queda huérfano. | **MEDIA** |

### 2.3. Síntesis cruda

Los **3 puntos top** candidatos (a confirmar con la medición):
1. **S1** envío a SAP sin descontar BO vigente del mismo cliente+SKU en otras órdenes.
2. **E6** split confirmed/BO en `commitPedidoCore` sin chequeo de BO vivo pre-existente.
3. **E1** importación Excel repetida sin reconciliar contra BO vigente.

---

## 3. Script de medición propuesto

### 3.1. Objetivo

Dimensionar en prod **cuántos pares cliente+SKU** tienen BO repartido en
más de una línea o más de una orden abierta, con cantidades, antes de
proponer cualquier fix.

### 3.2. Fuentes

- Colección `pedidos` (todas las abiertas: `closedAt == null` AND
  `transferidoSAP.via == null` OR `transferidoSAP.docNum == null`).
- Colección `revision_waitlist` (todas las abiertas: `closedAt == null`,
  `stage != 'consumed'`).
- Pure `getStockBreakdown` del fixture reconstructor
  (`functions/core/pedido-snapshot-core.js`) para cada SKU muestreado:
  reutilizar para validar que `backorderApp.porCliente` matchea con la
  cola real que vemos en los docs.

### 3.3. Métricas de salida (shape del output)

El script imprime en stdout + genera `docs/auditoria/35_BO_INFLADO_MEDICION.md`:

#### Métrica M1 — Pares cliente+SKU con BO repartido

```
| cardCode | clientName | sku | n_orders | n_lines | qty_total_bo | qty_max | antigüedad_oldest | antigüedad_newest |
|----------|------------|-----|----------|---------|--------------|---------|-------------------|-------------------|
| C001     | FOO        | SK1 | 3        | 4       | 15           | 8       | 65d               | 2d                |
```

- `n_orders`: cantidad de documentos `pedidos` (state='BO' con qtyOpen>0) o
  `revision_waitlist` (con items.state='BO' efectivo).
- `n_lines`: suma de líneas state='BO' qtyOpen>0 (puede haber >1 por orden si §56 nunca unificó históricamente).
- `qty_total_bo`: sum(qtyOpen) de todas las líneas BO vivas del par.
- `qty_max`: max(qtyOpen) de una línea individual.
- `antigüedad_oldest/newest`: edad en días del BO más viejo / más nuevo (`createdAt` del pedido padre o `asigRevertidaAt` si vino de reversión).

#### Métrica M2 — Pares con BO vigente + envío SAP reciente (candidatos a "BO fantasma post-envío")

Un par (cardCode, sku) donde:
- Existe línea `state='BO' qtyOpen>0` en pedido A.
- Existe línea `state='invoiced'` o `state='confirmed' + transferidoSAP.docNum != null` en pedido B del mismo cliente+SKU **DESPUÉS** de que se creó el BO.

```
| cardCode | sku | bo_order | bo_qty | bo_createdAt | sap_order | sap_qty | sap_invoicedAt | delta_dias |
|----------|-----|----------|--------|--------------|-----------|---------|-----------------|------------|
```

Esto cuantifica S1/S2 directamente.

#### Métrica M3 — Breakdown.backorderApp.porCliente > fisicoDep11 para un SKU

Para los top-N SKUs por `backorderApp.total`, listar cuánto excede físico
disponible. Si por ejemplo SKU X tiene backorderApp.total=50 y
fisicoDep11=5, hay un gap de 45u esperando reparto / forecast que puede
estar inflado.

```
| sku | fisico | backorderApp_total | backorderApp_porCliente_count | asignadas_total | gap_libre |
```

#### Métrica M4 — Pares cliente+SKU con BO > 90d (candidatos a cleanup §37)

```
| cardCode | sku | qty | createdAt | edad_dias |
```

#### Métrica M5 — Órdenes abiertas por cliente (> 1)

Reutiliza la lógica de `scripts/audit/P_clientes_multiple_waitlists.cjs`,
pero cross-ref con `pedidos` también. Mide §42 compliance real.

```
| cardCode | clientName | n_waitlists_abiertas | n_pedidos_bo_abiertos | fecha_mas_vieja | fecha_mas_nueva |
```

#### Métrica M6 — Pares cliente+SKU donde una orden tiene ambos: ASIG + BO vivos (sobre-asignación persistente §40.11)

```
| cardCode | sku | n_asig | qty_asig | n_bo | qty_bo | pedidosIds |
```

(§40.11 debería haber auto-revertido via `revertSobreAsignadas`, pero
puede haber casos nuevos entre snapshots.)

#### Métrica M7 — Resumen agregado (encabezado del output)

```
Total pares cliente+SKU con BO vigente: N
  - En 1 orden: X (OK, 1 BO = 1 orden)
  - En 2+ órdenes: Y (CANDIDATO A FUSIÓN)
Total unidades BO vigentes: Z
Total unidades BO en pares con 2+ órdenes: Z2 (= potencial reducción)
% de inflación estimada: (Z2 - count_unique_pairs_multi) / Z
Pares con BO + envío SAP posterior: W (candidato a descuento post-salida)
Unidades reducibles por descuento post-salida: W_u
```

### 3.4. Shape técnico del script

- CommonJS (`.cjs`) como el resto de scripts/audit/.
- Lee prod (`projectId: 'app-vendedores-shimano'`).
- **Por default `--dry-run`**: imprime todo sin tocar nada.
- **SIN `--apply`** implementado: la medición no muta Firestore. Si en
  el futuro se agrega `--apply`, debe pasar por §55 (snapshot `_backfill`
  por doc modificado).
- Timeout defensivo: query global de `pedidos` abiertos puede ser pesada;
  usar paginado si > 5000 docs.
- Output markdown en `docs/auditoria/35_BO_INFLADO_MEDICION.md` (patrón
  §P + §T + §J).

### 3.5. Query lógica (sin ejecutar)

```sql
-- Pseudo-SQL para claridad; Firestore no soporta joins reales.

-- M1: pares con BO en >1 línea u >1 orden
SELECT cardCode, sku, COUNT(DISTINCT pedidoId) as n_orders,
       COUNT(*) as n_lines, SUM(qtyOpen) as qty_total, MAX(qtyOpen) as qty_max,
       MIN(pedido.createdAt) as oldest, MAX(pedido.createdAt) as newest
FROM pedidos p JOIN p.lines l
WHERE p.closedAt IS NULL
  AND l.state = 'BO'
  AND l.qtyOpen > 0
GROUP BY cardCode, sku
HAVING COUNT(DISTINCT pedidoId) > 1 OR COUNT(*) > 1
ORDER BY qty_total DESC;

-- M2: BO vigente + envío SAP posterior
-- Para cada par (cardCode, sku) de M1, buscar si existe otro pedido del
-- mismo par con state='invoiced' o transferidoSAP.docNum != null y
-- confirmedAt/invoicedAt > bo_order.createdAt.

-- M3: top SKUs backorderApp.total
-- Reusar getStockBreakdown(sku) para cada SKU del catálogo (o filtrar top-50
-- por backorderApp.total). Comparar con fisicoDep11 + asignadas.total.

-- M4: BO vieja (>90d)
SELECT cardCode, sku, qtyOpen, pedido.createdAt
FROM pedidos p JOIN p.lines l
WHERE l.state = 'BO' AND l.qtyOpen > 0
  AND p.createdAt < NOW() - INTERVAL 90 DAY;

-- M5: §42 compliance (ya lo cubre P_clientes_multiple_waitlists.cjs — extender)

-- M6: ASIG + BO vivos en MISMA orden para mismo SKU
SELECT pedidoId, cardCode, sku,
       SUM(CASE WHEN state='ASIG' THEN qtyOpen ELSE 0 END) as qty_asig,
       SUM(CASE WHEN state='BO' THEN qtyOpen ELSE 0 END) as qty_bo
FROM pedidos p JOIN p.lines l
WHERE p.closedAt IS NULL AND qtyOpen > 0
GROUP BY pedidoId, cardCode, sku
HAVING qty_asig > 0 AND qty_bo > 0;
```

En Firestore se traduce a:
1. `collection('pedidos').where('closedAt', '==', null).get()` → iterar
   todos los docs. Alternativa: filtrar por `transferidoSAP.docNum == null`
   si está indexed.
2. Para cada pedido, iterar `lines[]`, agrupar en Map por
   `cardCode|sku` dentro del script.
3. Para M2, hacer segundo pase con `state IN ('invoiced', 'confirmed')`
   AND `transferidoSAP.docNum != null`.

---

## 4. Riesgos y edge cases a tener en cuenta

### 4.1. Riesgos del *proceso de medición*

- **R-MED-1**: query sin index en `transferidoSAP.docNum` requiere scan.
  OK para 1-time medición (puede tardar algunos minutos).
- **R-MED-2**: `createdAt` de pedido padre vs `confirmedAt` vs
  `asigRevertidaAt` son distintos. Para "antigüedad del BO" usar la más
  precisa disponible por línea (puede estar en `line.asigRevertidaAt` si
  vino de §40.5).
- **R-MED-3**: líneas con `qtyOpen==0` pero `state='BO'` existen (líneas
  parcialmente consumidas). Filtrar `qtyOpen > 0` para contar demanda
  viva.
- **R-MED-4**: `revision_waitlist` tiene `items[]` con shape distinto a
  `pedido.lines[]`. En waitlist cada item representa qty pedida pero NO
  tiene `state` resuelto todavía (ese split sucede en commitPedidoCF).
  Para la M1 principal, contar waitlist como "demanda pendiente" aparte
  de BO vivo en `pedidos`.

### 4.2. Edge cases del dominio

- **EC-1**: cliente con `cardCode==''` (prospecto). Agrupar por
  `clientName` como fallback (patrón M_pedidos_key_o_clientname_vacio).
- **EC-2**: SKU en pedido con precio distinto en órdenes distintas. Para
  la métrica M1 no importa el precio, solo qty.
- **EC-3**: BO vivos de clientes con `transferidoSAP.via='app_only'` del
  incidente 23/10 (ya reparados por script W). Si quedó alguno sin
  reparar, aparece acá. Documentar en el output.
- **EC-4**: pedidos "GENERAR BACKORDER" (`_gbConfirmar`) tienen shape
  `tipo='backorder'`. Son 100% BO por diseño. Hay que incluirlos pero
  marcarlos — son el caso canónico de M1 (siempre un cardCode+SKU en
  min 1 orden). El inflamiento aparece cuando hay 2+ "generar backorder"
  del mismo cliente+SKU.
- **EC-5**: unificación §56 fusionó históricamente duplicados dentro de
  waitlist; los pedidos pre-§56 (ante v1435, 2026-10-24) pueden tener
  BOs duplicados dentro de UNA sola orden (`n_lines > 1 && n_orders = 1`).
  Ese caso es dato: lo cuenta M1 pero NO es "regla fundamental rota"
  (lo era antes). Posibles líneas fantasma.
- **EC-6**: pedidos sync-SAP (`sync-sap-orders-core.js`): tienen `source`
  pero no son creación app. Sus líneas no empiezan nunca en BO (vienen de
  SO SAP). Ignorar `source='sync-sap'` en M1/M2.

### 4.3. Riesgos del *análisis cualitativo* (para la decisión futura)

- **R-ANA-1**: definir "la cantidad total que quiere el cliente" como
  **el input más reciente** (del Excel/CPST/manual) es decisión de
  negocio. Alternativa: tomar el máx entre pedidos abiertos. Mariano
  tiene que validar.
- **R-ANA-2**: forecasting consume `backorderApp.porCliente` como base.
  Si fusionamos BOs duplicados, el forecast ve menor demanda — puede
  underestimar reposición si históricamente venían contando duplicados.
  **Mitigación**: antes del fix, exportar snapshot de `backorderApp` para
  el modelo de forecast con la métrica cruda; después del fix, recalibrar.
- **R-ANA-3**: VDE puede *querer* 2 líneas de BO del mismo SKU en la
  misma orden (ej. 2 descuentos distintos, 2 motivos). HOY §56 ya no lo
  permite (dedupe fuerza fusión por SKU). Verificar que no haya
  casos legítimos.
- **R-ANA-4**: BO en pedidos ya enviados a SAP (`transferidoSAP.docNum`
  presente) pero con línea `state='BO'` todavía viva (porque SAP solo
  facturó la parte confirmed). Esos BOs son "huérfanos legítimos" según
  §40.8 — SAP no los reserva pero la app sí los muestra como demanda
  pendiente. ¿Debería la app cancelarlos automáticamente cuando la parte
  confirmed se factura? Decisión futura.

---

## 5. Hallazgos durante el análisis (NO fixear — para info)

### 5.1. Hallazgo "oneliner" potencial: `_origenesACancelar` solo cubre ASIG propias

**Archivo**: `index.html:36677-36700` (`doConfirmPedido`).

El bloque v1280/§35 que cancela "orígenes" al enviar a SAP sólo
considera:
- `window._pendingPedidoOrigenes` (del waitlist CPST).
- `docData.lines[].asigRefs` (identidad por línea §35).

**NO contempla** `pedidos.lines` del mismo cliente+SKU con
`state='BO' qtyOpen>0` en otras órdenes abiertas. Caso típico salida S1
exactamente.

**NO LO ARREGLO** (regla §31: auditoría ≠ corrección). Es dato para el
diseño futuro.

### 5.2. §56 no reconcilia hacia pedidos ya confirmed/pending

`mergeLinesFromOrders` + `dedupeLinesByCode` operan dentro de UN waitlist
siendo creado/unificado. No tocan `pedidos` state='BO' abiertos de otras
órdenes del mismo cliente. Confirma que el gap es sistémico, no un
descuido local.

### 5.3. `_gbConfirmar` (Generar Backorder manual) nunca consulta BO vigente

En `index.html` el flow crea `pedidos.add({tipo:'backorder', lines: [...]})`
directo sin contrastar contra `revisionWaitlist`/`globalPedidos` previos
para el mismo cliente+SKU. Severidad E5 ALTA.

### 5.4. §42 cubre 1 orden abierta por cliente en `revision_waitlist`, no en `pedidos`

Un cliente puede tener 1 waitlist abierta + N pedidos state='BO' en
distintas órdenes `pedidos` ya pasadas a Pendientes. §42 solo restringe
waitlists. Esto es correcto por diseño (los pedidos pending/confirmed son
compromisos cerrados), pero significa que la "fusión por cliente+SKU"
puede necesitar atravesar también `pedidos` abiertos.

---

## 6. Lista de tests a escribir (futuro, no ahora)

(Para cuando se implemente el fix. Lo dejo para que el design doc esté
completo según el prompt original.)

- `tests/unit/bo-reconciliar-entrada.test.js`: fusión BO cliente+SKU en
  importación Excel + alta manual + unificación §42 + CPST + Generar
  Backorder.
- `tests/unit/bo-descontar-salida.test.js`: envío SAP cancela BO vigente
  del mismo cliente+SKU hasta `max(bo - x, 0)` (según prompt). Incluye
  caso BO distribuido en 2+ órdenes (orden de consumo: FIFO por
  `createdAt`).
- `tests/unit/property/bo-invariante-cliente-sku-fastcheck.test.js`:
  property-based ≥200 runs — en cualquier estado, `sum(line.qty) para
  line.state='BO' qtyOpen>0 group by cardCode,sku <= demanda declarada
  último input`.
- `tests/functions/commit-pedido-bo-descuento.test.js`: STRICT mock §58.
  Simula envío SAP con BO vigente en otra orden → verifica cancelación
  en runTransaction + operations_log entry.
- `tests/unit/audit/bo-reconciliar-sync.test.js`: §57 — regla vive en
  `src/pure/bo-reconciliar.js` + `functions/core/bo-reconciliar.js`.

---

## 7. Plan de implementación (resumen, para el futuro)

(Esqueleto por fases. Mariano decide después de ver el output del
script.)

### Fase A — MEDICIÓN (ESTA tarea, plan-only)
- Script `W_backorder_inflado_medicion.cjs` (dry-run).
- Correr contra prod con OK Mariano.
- Output markdown en `docs/auditoria/35_BO_INFLADO_MEDICION.md`.
- Decisión: ¿cuántas unidades BO inflado tiene prod HOY?

### Fase B — DISEÑO FINO (post-medición)
- Diseño de la fila roja en modal "lista de espera" (control E1-E5).
- Diseño del descuento post-SAP (control S1-S2).
- Mockup del modal confirm "cliente ya tiene N en BO".
- Trade-offs §56 fusión / regla "cantidad declarada reemplaza".

### Fase C — IMPLEMENTACIÓN POR FASES
1. **Fase C1 — descuento salida (determinista, no UX)**: cancelar BO en
   commitPedidoCF via campo nuevo en payload o scan server-side. Patrón
   §63 (CF con validación server-side + runTransaction §58).
2. **Fase C2 — control de entrada (requiere UX)**: fila roja + input
   pre-cargado + bloqueo "pasar a pendientes" con rojos sin resolver.
3. **Fase C3 — fusión §56 extendida a BO vigente**: cuando el VDE agrega
   SKU que ya tiene BO vivo en pedido pending, pre-cargar input con
   "demanda actualizada" en vez de sumar.

### Fase D — TESTS + VERIFICACIÓN
- Tests arriba antes de merge.
- Script de verificación post-fix: correr W de nuevo, comparar métricas
  antes/después.

---

## 8. Entregables actuales (plan-only)

1. ✅ Este documento `docs/plans/2026-10-25-backorder-inflado-analisis.md`.
2. ✅ Script `scripts/audit/W_backorder_inflado_medicion.cjs` (dry-run only).
3. ❌ **NO** se implementa fix.
4. ❌ **NO** se corre el script contra prod (requiere OK Mariano para
   permission + output al Desktop).
5. ❌ **NO** se tocan `src/`, `functions/`, `index.html`, rules.

---

## 9. Status del `--apply` externo mencionado por Mariano

El prompt del usuario menciona:
> "S --apply (fusión de SKUs duplicados) queda frenado hasta que este
> análisis diga como fusionar sin sumar ciegamente."

El script `scripts/audit/S_dry_run_fusion_duplicados.cjs` existe desde
v1435 (§56). Su `--apply` sigue frenado. Este plan NO lo arranca ni lo
diseña — es tarea aparte post-medición.
