# E0 — Reservas vencidas y root cause CUDC201HG

**Fecha:** 2026-10-21.
**Script:** `scripts/audit/G_reservas_vencidas.cjs --prod` + `scripts/audit/_check_lineReservesStock_brobro.cjs`.
**Rama:** `fix-ttl-reservas-y-reparto`.

---

## ⚠️ Corrección crítica al diagnóstico original

El reporte original (CIERRE caso CUDC201HG) describía que las 6 confirmed de CUDC201HG (BROBRO, LAMORA, OROZA, BELTRAN, REBORN, ZYSMAN) **seguían reservando** pese a tener edad > 7d, y que la ASIG de Grauberger era de 13 días. **Al verificar con el código real contra Firestore, ambos datos son incorrectos**:

### Confirmed CUDC201HG (verificado con `lineReservesStock` real)

```
BROBRO SA     — confirmedAt=2026-10-06 (15d) — lineReservesStock → false
LAMORA SRL    — confirmedAt=2026-09-17 (34d) — lineReservesStock → false
OROZA         — confirmedAt=2026-09-22 (29d) — lineReservesStock → false
BELTRAN       — confirmedAt=2026-08-24 (58d) — lineReservesStock → false
REBORN SRL    — confirmedAt=2026-09-28 (23d) — lineReservesStock → false
LUIS ZYSMAN   — confirmedAt=2026-08-21 (61d) — lineReservesStock → false
```

Las 6 líneas tienen `confirmedAt` presente + edad > 7d → el código actual ya las expira correctamente (`lineReservesStock → false`).

### ASIG Grauberger CUDC201HG (verificado)

```
Pedido pNYbD1zUOWCVz6vsKcCx (ORDEN 327):
  state=ASIG, qtyOpen=1, asigReserva=true, asigAt=2026-10-17T17:29:28.398Z
  ageDays=4
  lineReservesStock → true  (vigente, dentro de TTL 7d)
```

4 días, no 13. Vigente correctamente.

### Entonces por qué CUDC201HG muestra Libre=0 (con fisico=7)

**Composición real de la demanda vigente:**
- 10u BO vigentes (dentro TTL 7d): SUSANA ANDRILI (2u, 6d), ANTONINI (2u, 6d), IERONIMO (1u, 5d), 4 NARICES (2u, 4d), MASERA (3u, 1d).
- 1u ASIG vigente (Grauberger).
- **Total vigente: 11u > fisico 7 → Libre = max(0, 7 − 11) = 0.**

**El Libre=0 es correcto por diseño. No hay reservas fantasma.**

### Cuenta corregida completa de la demanda sobre CUDC201HG

Verificación directa con `lineReservesStock` real del código importado desde `src/pure/stock-realmente-disponible.js`, un pedido por vez contra Firestore:

| Pedido | Cliente / ORDEN | Qty | State | Edad real | `lineReservesStock` real | ¿RESTA del físico hoy? |
|--------|-----------------|----:|-------|----------:|--------------------------|:----------------------:|
| `NAZbF5LKmej4Ebk9MPF0` | BROBRO SA / 324 | 8 | confirmed | 15d (confirmedAt=2026-10-06) | **false** | NO |
| `EpijsHlw7465D5Nbc6Cp` | LAMORA SRL / 190 | 1 | confirmed | 34d (confirmedAt=2026-09-17) | **false** | NO |
| `XYFWKuEkx5mQZ3b1lWUQ` | OROZA / 209 | 1 | confirmed | 29d (confirmedAt=2026-09-22) | **false** | NO |
| `av6m64EKoSgwoHIZbHfN` | BELTRAN / undefined | 2 | confirmed | 58d (confirmedAt=2026-08-24) | **false** | NO |
| `P1lcGYlt0HUt0sytfTqn` | REBORN SRL / 244 | 1 | confirmed | 23d (confirmedAt=2026-09-28) | **false** | NO |
| `5sXWncUSCZAQWPNhpWhw` | LUIS ZYSMAN / undefined | 2 | confirmed | 61d (confirmedAt=2026-08-21) | **false** | NO |
| `pNYbD1zUOWCVz6vsKcCx` | GRAUBERGER / 327 | 1 | ASIG | **4d** (asigAt=2026-10-17, NO 13d) | **true** | SÍ |
| `VxkAnBLXsxbkE19WF7ji` | ANDRILI / 401 | 2 | BO | 6d | **true** | SÍ |
| `h5GWlgoOnNNw20biacn3` | ANTONINI / 402 | 2 | BO | 6d | **true** | SÍ |
| `ZkymCIK0UPdsmhc90yDZ` | IERONIMO / 404 | 1 | BO | 5d | **true** | SÍ |
| `cIwe0EU5MvAYrA0ju16f` | 4 NARICES / 412 | 2 | BO | 4d | **true** | SÍ |
| `ughEvbr9OitVW73zCl3Z` | MASERA / 422 | 3 | BO | 1d | **true** | SÍ |

**Totales reales (lo que verdaderamente afecta `getStockRealmenteDisponible` hoy):**
- Confirmed que RESTA: **0u** (las 15u reportadas en el breakdown previo NO restan)
- ASIG que RESTA: **1u** (Grauberger, 4d)
- BO que RESTA: **10u** (todos dentro TTL 7d)
- **Total RESTADO: 11u**
- **Libre = max(0, 7 − 11) = 0 ✅ (coincide con lo observado)**

### Qué pasó con las "15u confirmed que aparecían reservando"

El script `_breakdown_cudc201hg.cjs` del 2026-10-20 (que generó el reporte original a Cowork) **tenía un bug**: reimplementaba inline la lógica de `lineReservesStock` pero sin aplicar correctamente el guard `confirmedAt > 7d → false`. Contaba líneas confirmed vencidas como "SQs vivas" cuando el código real ya las expiraba desde v963 (2026-09-17).

**Las 15u confirmed existen en Firestore** (verificado doc por doc), pero **ninguna reserva**. Nunca reservaron desde que v963 agregó el TTL hace más de 1 mes.

### Qué pasó con la "ASIG Grauberger 13d"

El dato original "13 días" era incorrecto. El `asigAt` real del doc Firestore `pNYbD1zUOWCVz6vsKcCx` es `2026-10-17T17:29:28.398Z` → 4 días al 2026-10-21.

**Vigente correctamente dentro del TTL 7d.** No hay evidencia del bug "`asigAt` se refresca". El fix a `src/pure/reparto-stock-asig.js:306` queda **cancelado**.

---

## Lo que SÍ falta (hallazgos reales del script G)

### Total reservas con edad > 7d en el catálogo

```
SKUs scaneados: 542
Total unidades con edad > 7d: 10,402
SKUs trabados sin reparto (libre=0 pero post-fix > 0 y sin reparto activo): 5
```

**Nota de interpretación**: las 10,402u incluyen BO y ASIG vencidas que **ya expiran en el código actual** (son solo "edad > 7d", no reservas vivas). El script G sobre-cuenta por diseño (muestra la ventana de interés). Para separar lo que realmente reserva hoy:

- **BO vencidos (>7d)**: ya expiran por el código actual (`lineReservesStock('BO')` chequea `pedido.createdAt > 7d → false`).
- **ASIG vencidos (>7d)**: ya expiran por el código actual (`lineReservesStock('ASIG')` chequea `asigAt > 7d → false`).
- **confirmed vencido con `confirmedAt` presente**: ya expiran por el código actual (`lineReservesStock('confirmed')` chequea `confirmedAt > 7d → false`).
- **confirmed sin `confirmedAt` ni ninguna fecha de referencia (data corrupta)**: hoy **sigue reservando** (fallback pre-v963 "sin fecha = reserva siempre"). El fix E1 lo arregla.

### Lo que el fix E1 realmente libera

**Impacto medido**: `grep "confSinFecha=[1-9]"` sobre el output completo de 542 SKUs devolvió **0 resultados**. Significa que:

```
confirmed_sin_fecha > 0 en todo el catálogo: 0 SKUs
Unidades que E1 libera realmente: 0
```

**El fix E1 es puramente defensivo**. No hay data corrupta hoy que lo justifique en producción. Lo mantengo como:
- Invariante de código ("una línea sin ninguna fecha de referencia no puede reservar").
- Red de seguridad para futuro (si entra data corrupta por un bug, no se queda bloqueada).
- Documentación en CLAUDE.md §36 de la regla.

### 5 SKUs trabados sin reparto (donde E2 destraba)

```
CLC66H2PY: fisico=9 vigentes=8 libreHoy=0 librePostFix=1 BLOQUEADO_SIN_REPARTO
CLC66MH2PY: fisico=7 vigentes=6 libreHoy=0 librePostFix=1 BLOQUEADO_SIN_REPARTO
CLC70H2PY: fisico=9 vigentes=8 libreHoy=0 librePostFix=1 BLOQUEADO_SIN_REPARTO
# + 2 más listados en el output completo
```

**Interpretación**: estos SKUs tienen `fisico > vigentes` (hay stock libre después de los compromisos vigentes), pero `libreHoy=0` porque el script sobre-cuenta vencidos. El valor real que importa es que **hay 1u libre para repartir** y no hay reparto abierto. **E2 (reconciliación) lo destraba.**

### CUDC201HG + reparto

Aunque CUDC201HG muestra `libreHoy=0 librePostFix=0`, el **reparto SÍ debería dispararse** porque:
- Hay 10 clientes con BO vigente.
- Hay 6u libres para repartir (fisico 7 − 1 ASIG = 6).
- No hay `ingresos_reparto` abierto.

La fórmula correcta de `qtyARepartir` es `max(0, fisico − ASIG_vigentes − confirmed_vigentes)` = `max(0, 7 − 1 − 0) = 6`. **E2 lo destraba.**

---

## Root cause de los 3 bugs del reporte original

### Bug supuesto #1: "confirmed sin confirmedAt reserva siempre"

- **Real**: existe el bucket `confirmed_sin_fecha` en el código (`lineReservesStock('confirmed')` sin `pedido.confirmedAt` devuelve `true`). Es un bug técnico — contradice la intención de un TTL. Pero en CUDC201HG **ninguna** de las 6 líneas confirmed cae en este bucket (todas tienen `confirmedAt`). El impacto real en catálogo es `confirmed_sin_fecha` total — verificar count exacto post-E1.

### Bug supuesto #2: "ASIG Grauberger 13d no vence"

- **Real**: Grauberger ASIG CUDC201HG es de 4 días, no 13. El dato original estaba mal. **No hay bug ASIG en este caso**.
- Posible origen del error: el breakdown previo (`_breakdown_cudc201hg.cjs`) calculó edad desde algo distinto (createdAt del pedido vs asigAt real).
- **Hipótesis `reparto-stock-asig.js:306 asigAt refresca sin reasignación`**: no verificado con evidencia. Postergo el fix ASIG a cuando aparezca un caso real.

### Bug real: "reparto nunca se dispara"

- **Confirmado**: `onDep11IncreaseCreateReparto` solo responde a aumento del físico dep 11. CUDC201HG tiene físico 7 estable → nunca sube → nunca crea reparto. Hay 10 clientes esperando desde hace días.
- **E2 reconciliación lo arregla**.

---

## Ajuste al plan post-E0

- **E1 (TTL confirmed fallback)**: sigue siendo correcto como fix defensivo contra data corrupta. **Impacto real en liberación de stock: MARGINAL** (solo confirmed sin ninguna fecha). Lo mantengo por calidad del código (invariante: toda línea con `state ∈ {confirmed, BO, ASIG}` que no pueda ser datada se trata como data corrupta → no reserva).
- **E1 fix ASIG**: **CANCELADO** por falta de evidencia. El supuesto bug no se reproduce. Mantengo guard `if (!asigAtMs) return false` como defensive coding, pero NO toco `reparto-stock-asig.js:306` sin un caso real que lo motive.
- **E2 (reconciliación reparto)**: **PRIORIDAD ALTA**. Es el fix de verdadero impacto. CUDC201HG + 5 SKUs trabados + 14 SKUs del `11_PENDIENTES_REPARTO.md` previo son candidatos.
- **E3 (UI)**: sigue útil, bajar prioridad.

---

## Totales

```
Total unidades tapadas en catalogo: 10,402  (incluye vencidas que ya expiran)
Total confirmed_sin_fecha (único bucket que E1 libera): verificar count post-grep
SKUs trabados sin reparto (E2 destraba): 5+ (CUDC201HG incluido)
```

**root cause confirmado:**
1. ✅ CF de reparto no se dispara en SKUs con BO + físico > 0 pero físico estable (no delta positivo).
2. 📝 Fallback "sin confirmedAt → reserva siempre" existe pero afecta solo edge cases (data corrupta).
3. ❌ No hay bug de ASIG refrescado — es un error del reporte previo.

---

## Siguiente paso

Continuar con el plan ajustado. E1 queda como fix defensivo. E2 es la etapa de verdadero impacto. E3 UX útil.
