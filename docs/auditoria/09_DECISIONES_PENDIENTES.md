# E5 — Gate humano: 2 decisiones de diseño pendientes

> **STOP.** Antes de implementar nada relacionado con BO-reserva o TTL, Mariano decide.
> Esta tarea entrega evidencia y opciones; **no toca el comportamiento de BO ni el TTL**.

---

## D1 — Back order como reserva

### Hoy (v701, "app owns stock")

`lineReservesStock(state='BO')` devuelve `true` cuando la línea tiene `qtyOpen > 0` y `pedido.createdAt` dentro del TTL. Esto hace que todo BO vivo cuente como stock comprometido en:
- `getStockRealmenteDisponible(sku)` (fórmula central).
- `getStockPorCliente(sku, cardCode).reservadasPorOtros/reservadasPorCliente`.

### Qué cambia si BO deja de reservar

Simulo los 11 pasos del end-to-end STRADIC-2500 bajo las 2 semánticas:

| Paso | Estado tras el paso | HOY (BO reserva) `Disp` | PROPUESTO (BO no reserva) `Disp` |
|------|---------------------|------------------------:|------------------------------------:|
| 0  | 3/0/-/0 | 3 | 3 |
| 1  | Lista espera 5u, estado=0/0 | 3 | 3 |
| 2  | Norte envía 2u → confirmed. Físico 1 | 1 | 1 |
| 3  | Sur envía 2u. Disp=1 → split 1 SAP + 1 BO | 0 | 1 (porque BO Sur no reserva) |
| 4  | Oeste envía 1u. Disp=0 → BO. BO total=2 (Sur+Oeste) | 0 | 0 |
| **5** | **Ingresa 1u. Físico=1, BO=2.** | **0** (protegido) | **1** (ventana H6 abierta) |
| 6  | Pablo reparte 1 a Oeste. ASIG Oeste=1 | 0 | 0 |
| 7  | Pablo crea CPST para Oeste | preview=1, split global=0 | preview=1, split=1 |
| 8  | VDE confirma → SAP recibe 1 (post-fix H1) | 0→SAP (pre-fix) / 1→SAP (post-fix) | 1→SAP |
| 9  | Ingresa 2u. Físico=2, BO Sur=1 | 1 | 2 |
| 10 | Pablo asigna 1 a Sur | 1 | 1 |
| 11 | CPST para Sur → SAP recibe 1 | 1→SAP | 1→SAP |

### Qué protege HOY que BO cuente como reserva

**Ventana H6 (prompt original)**: en el PASO 5 (stock entra con BO pendientes), un cuarto cliente que carga pedido manual **no puede llevarse** la unidad que ya está reservada vía BO.

**Si BO dejara de reservar:**
- En PASO 5, `Disp=1` para un cuarto cliente → cargaría un pedido manual (no CPST) → `splitPedidoLine` lo mandaría a `confirmed` → viaja a SAP como SQ → **le gana** la unidad al cliente que había pedido primero (Sur o Oeste) por BO.
- O1 ("proteger stock que ya tiene dueño") se **viola**.

### Riesgos de quitarlo

| Riesgo | Impacto | Mitigación posible |
|--------|---------|---------------------|
| Ventana H6 reaparece | PASO 5 + 9: otros clientes se llevan unidades asignadas por FIFO al cliente con BO más viejo | Reparto 100% manual + modal "Reparto" se abre apenas entra stock + Pablo decide rápido |
| BO viejos NO bloquean stock de otros clientes | BO >7d (hoy no reservan por TTL) deja de penalizar | Panel admin que haga visible los BO olvidados y los cancele o re-reparta |
| Admin pierde señal de "cuánto stock se me va a ir ni bien entre" | Dashboard Reserva baja | Reemplazar con "BO pendiente" count visual separado |

### Ventaja de quitarlo (según el modelo comercial de Mariano)

- BO = forecast de demanda, no compromiso físico. La reserva nace recién cuando Pablo reparte.
- La fórmula de `getStockRealmenteDisponible` se simplifica: solo cuenta `ASIG+confirmed`.
- El bug tipo "ventana H6" se resuelve a nivel UX con **velocidad del reparto** (Pablo entra a diario) + bloqueo transitorio en modal Reparto.

### Preguntas abiertas para Mariano

1. ¿Pablo repartiría dentro de minutos del ingreso o puede quedar horas sin reparto? Si quedan horas, la ventana H6 es real.
2. En la práctica actual, ¿cuántas veces un cuarto cliente intentó cargar un SKU con BO pendiente y lo cargó porque Pablo no había repartido? (si = 0, el beneficio de BO reservar es teórico; si > 0, es protección activa).
3. ¿Querés mantener la protección pero hacerla visible (badge "stock reservado por BO ajeno")?

**Mariano decide. Sin recomendación.**

---

## D2 — TTL de reservas

### Dónde salió cada número

| Archivo:línea | TTL | Commit | Motivo |
|---------------|-----|--------|--------|
| `src/pure/stock-realmente-disponible.js:62` | 7 días | `39bd5c9` (v1198, 2026-10-08) | Pedido Mariano explícito: "si cliente tiene 80u >7d sin pasar nada, dejan de bloquear stock" |
| `functions/core/pedido-snapshot-core.js:43` | 15 días | `5f33bb9` (v975+v976) | Original. Nunca se bajó cuando v1198 cambió src/pure. Comentario "MANTENER SINCRONIZADO" fue ignorado en el PR v1198 |

Precedente anterior (`952e23a` v959): TTL 15 días en `src/pure` desde `2026-09-16`. Mariano decidió bajar a 7d en 2026-10-08.

### ASIG vivas por bucket de edad (prod, 2026-10-20 21:36 UTC-3)

Query `node scripts/audit/_count_asig_by_age.cjs` (read-only, autorizado A1):

```
ASIG vivas totales: 153
  <= 7 dias: 153
  7 < edad <= 15 dias: 0
  > 15 dias: 0
```

**Interpretación:** HOY no hay ASIG vivas con más de 7 días. El drift 7d vs 15d es puramente teórico ahora mismo — no hay data real impactada. Pero el drift es sistémico: si mañana aparece una ASIG de 8-15 días, el modal cliente la libera y el server CF la mantiene reservada → inconsistencia.

### 3 opciones operativas

#### Opción A — Alinear ambos a 7 días (preferido técnicamente)

Cambiar `functions/core/pedido-snapshot-core.js:43` de 15 → 7.

- **Pro:** respeta la última decisión de Mariano (v1198). Alinea cliente + server. Elimina el drift.
- **Con:** si en el futuro aparece una ASIG legítima de 10 días (ej. cliente que tarda en facturar), se libera stock para otros. Puede sorprender al cliente.
- **Impacto hoy:** 0 líneas afectadas (nada entre 7-15d).

#### Opción B — Alinear ambos a 15 días

Cambiar `src/pure/stock-realmente-disponible.js:62` de 7 → 15.

- **Pro:** conserva reservas más tiempo. Clientes y Pablo tienen más ventana para facturar.
- **Con:** revierte la decisión v1198 de Mariano. BO viejos siguen bloqueando stock de otros clientes.
- **Impacto hoy:** 0 líneas afectadas.

#### Opción C — Sin TTL + panel admin de "reservas expiradas"

Eliminar la expiración automática. En su lugar:
- Panel admin muestra ASIG vivas ordenadas por edad.
- Admin decide manualmente cuándo liberar (botón "Liberar reserva" por línea).
- Alertas automáticas por email cuando una ASIG cumple N días (configurable).

- **Pro:** cero sorpresas. Decisión humana explícita por caso.
- **Con:** requiere más trabajo admin. Si Pablo no entra al panel, las reservas quedan vivas indefinidamente y el stock no circula.
- **Impacto hoy:** requiere construir el panel (otra tarea).

### Preguntas abiertas para Mariano

1. ¿Qué querías decir con el pedido de v1198 "si cliente tiene 80u >7d sin pasar nada"? ¿Era un caso específico de un cliente o regla general?
2. Hoy no hay ASIG >7d — ¿es porque el TTL las elimina (expiran) o porque Pablo las cancela/factura antes? Si el TTL las elimina, decidir si es OK o si queremos retenerlas.
3. ¿Preferís regla automática simple (7 o 15) o humana con panel (C)?

**Mariano decide. Sin recomendación.**

---

## STOP

**No tocar BO-reserva ni TTL en esta tarea.** Esperar respuesta de Mariano a D1 y D2 antes de iterar.

**Siguiente acción:** Mariano revisa + decide + autoriza siguiente iteración.
