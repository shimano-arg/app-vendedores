---
name: documenting-changes
description: Obligatorio para cualquier agente que modifique codigo en este repo. Documenta cada cambio con el formato ANTES/PROBLEMA/CAMBIO/POR-QUE/VERIFICACION para que futuros agents + humanos puedan reconstruir el contexto sin leer el diff. Use antes de todo commit no trivial.
---

# Documenting Changes — regla durable del repo

**Regla fuerte**: cualquier agente que modifique codigo en este repo DEBE agregar documentacion detallada del cambio ANTES de hacer commit. No alcanza con el mensaje de commit — el commit msg es resumen, la documentacion es el contexto completo.

El commit msg es para `git log`. La documentacion es para que **otro agente leyendo el repo 3 meses despues** entienda:
- Que habia antes del cambio
- Que problema teniamos (incident, bug reportado, regla de negocio, performance degradada)
- Que cambiamos exactamente
- Por que esa decision y no otra
- Como verificar que anda

Sin esto, cada nuevo agente arranca desde cero + lee git blame + descubre que el "fix obvio" ya se intento 3 veces + volvio a romper lo mismo. Los commit msgs no cuentan la historia completa.

## Por que esta regla existe

Historial reciente:
- **v469** (2026-07): bug de "pending fantasma" porque un agente cambio `eliminarPendiente` sin saber que habia una 2da definicion que lo pisaba (ver Frontend C1-C3 del audit 2026-10-07). El comentario `// v469 consolidacion` llego 2 meses tarde — el bug ya habia vivido 2 meses.
- **v1058 → v1003** (2026-09-18 → 2026-09-21): rollback de `enforceAppCheck=true` tomo 3 dias de debug porque nadie documento el delay de ~66h de propagation Console. Hubo que redescubrir el precedente (CLAUDE.md §22).
- **FATECHI** (2026-10-06): CF trigger tenia idempotent check desde v1006 pero el batch manual **NO** — nadie documento la asimetria. Fue a $$$ perdidos cuando el gap se activo.

Un cambio no documentado es un bug latente esperando a que un futuro agente lo repita.

## Cuando aplicar

**SIEMPRE que modifiques codigo**, excepto:
- Typo en un comentario (literalmente 1 char)
- Bump de version (APP_VERSION/CACHE_VERSION) sin cambios de logica
- Rebuild de bundle sin cambios en src/
- Rename cosmetico de variable local sin impacto cross-file

**OBLIGATORIO** para:
- Cualquier cambio en `functions/` (Cloud Functions)
- Cualquier cambio en `src/domains/*.js` (bundle)
- Cualquier cambio en `firestore.rules` o `storage.rules`
- Cualquier cambio en `index.html` que toque Firestore writes/queries, SAP calls, auth, o UI critica
- Cualquier cambio que corrija un incidente / bug reportado
- Cualquier cambio motivado por un audit / review externo
- Cualquier cambio de performance (incluso si parece micro)
- Cualquier cambio en workflows GitHub Actions
- Cualquier cambio de rate limits, timeouts, o thresholds

## Donde escribir

### Ubicacion segun scope del cambio

1. **Hotfix individual (1-3 archivos tocados)**: entry nueva en `README.md §41 Changelog vigente` siguiendo el formato de ese section.
2. **Feature / refactor mediano (4-10 archivos)**: documento aparte en `docs/CHANGELOG-<feature>-<fecha>.md`. Agregar link al README §41.
3. **Audit / review / rework grande**: documento `docs/AUDIT_<topic>_<YYYY-MM-DD>.md` con detalle de TODOS los fixes. Agregar link al README §41 por cada round shippeado.
4. **Plan upfront (antes de ejecutar)**: `docs/plans/<YYYY-MM-DD>-<feature>-plan.md`.
5. **Spec de diseno**: `docs/specs/<YYYY-MM-DD>-<feature>-design.md`.

### Reglas de ubicacion

- **Siempre** actualizar `README.md §41 Changelog` con bump de version + bullet rapido + link al doc extendido si lo hay.
- **No** mezclar changelog con documentacion de arquitectura (eso va a README §otras secciones).
- **No** escribir el detalle completo adentro del commit msg (git log pierde formato + searchability).
- **Si el cambio tiene stakeholders externos** (Pablo, Berón, Santi, Mariano): mencionar en el doc QUIEN lo pidio y CUANDO.

## Formato obligatorio

Cada cambio documentado DEBE tener estas 5 secciones. Si falta una, el cambio esta mal documentado — rechazarlo o completarlo antes de merge.

```markdown
### <categoria> <titulo corto>

**Version**: vXXXX
**Archivos tocados**: ruta/al/archivo.js:LINE, ruta/otro.js
**Motivacion**: <incident | audit | bug reportado | feature requerida>

**Antes**:
<Que hacia el codigo antes del cambio. Codigo real literal si es posible,
sino parafraseo preciso. Incluir el flow completo si es relevante.>

**Problema**:
<Que estaba mal. Precedente, incidente especifico (fecha + impacto $$ si aplica),
o riesgo latente. Si fue reportado por alguien, mencionar el nombre + fecha.>

**Cambio**:
<Que hace el codigo ahora. Codigo real literal del fragmento relevante.
Si es un rename, mostrar before/after. Si es un replace, el before/after.>

**Por que**:
<Justificacion de la decision tecnica. Alternativas consideradas + por que
descartadas. Trade-offs. Constraints (perf, seguridad, backward-compat).>

**Verificacion**:
<Como se valido. Tests que pasan. Metricas antes/despues. Logs esperados.
Deploy status. Si requiere monitoring posterior, cuanto tiempo + que mirar.>

**Rollback**:
<Si el cambio sale mal, como revertir. Si es safe revertir (sin data loss),
decirlo explicito. Si NO es safe revertir, documentar la razon.>
```

## Ejemplo bien documentado (modelo)

```markdown
### Backend C1 — Idempotent check en batch manual SAP

**Version**: v1172
**Archivos tocados**: src/domains/sap-admin-panel.js:1058
**Motivacion**: audit multi-agent 2026-10-07 (Backend agent flag CRITICAL)

**Antes**:
El batch manual "Carga a SAP" (admin panel) hacia `await sapSL.createQuotation(payload)`
directamente sin consultar primero si SAP ya tenia una SQ con `NumAtCard=pedidoId`.
Lineas 1055-1058:
    } catch (preErr) {
      console.warn('[sap-send] preCheck exception (fail-open):', preErr);
    }
    const r = await sapSL.createQuotation(payload);

**Problema**:
Precedente FATECHI 2026-10-06 (pedido Ful3HCXvXt5mQdpJWwKY): primer POST del CF
trigger tomo >5min bajo carga, lockTTL expiro, admin reintento via batch manual
→ segundo POST creo SQ 2000284 huerfana → $7.3M extra en SAP + reclamos cliente.
La CF trigger (v1006) y el listener client (v1144) ya tenian el idempotent check
desde esa fecha, pero el batch manual era el ULTIMO vector FATECHI vivo — nadie
lo cubrio porque la asimetria no estaba documentada en v1006.

**Cambio**:
Insertado bloque idempotent-check antes del createQuotation. Si SAP ya tiene SQ
con `NumAtCard=p._fsId`, marcar como transferida via='service_layer_idempotent' +
`sent++` + `continue` para skipear el POST. Fallback defensivo: si la query falla,
log warning + seguir con POST normal (no bloquear envios legitimos). Codigo
agregado entre linea 1057 y 1058 (ver sap-admin-panel.js para detalle).

**Por que**:
- Pattern replicado del listener client-side (sap-auto-send-listener.js:166) para
  consistencia — misma funcion `findQuotationByNumAtCard` reusada.
- `via='service_layer_idempotent'` (nueva clave) distingue el hit vs. el envio real
  — util para audit log + metricas de cuantos duplicados prevenidos.
- Fallback defensivo (no bloquear si GET falla) es intencional: el riesgo de
  bloquear un envio legitimo por un error transient de SL supera el riesgo de un
  duplicado teorico (que las otras 2 defensas — AbortController v1172 + lock no
  liberar en 5xx v1172 — ya cubren).
- Alternativa descartada: refactor a un wrapper comun en sap-sl-client. Mas limpio
  pero mas invasivo + mas superficie para introducir bug nuevo. Preferido fix
  quirurgico in-place.

**Verificacion**:
- Unit tests 670/670 pass sin regresiones.
- notify-quotation-sent agregado test case para `via='service_layer_idempotent'`
  (5 nuevos cases v1172).
- Deploy pending gradual monitoring 1 semana — mirar `operations_log` por entries
  con `via='service_layer_idempotent'` (indica que previno un duplicado real).
- Si > 2 hits por semana → investigar por que los lockTTLs se estan agotando mas
  que esperado.

**Rollback**:
Safe revertir — el bloque es defensive guard. Si SAP SL devuelve false positives
y bloquea envios legitimos, se puede revertir en 5min via `git revert` del commit.
No hay data loss. Los pedidos marcados `via='service_layer_idempotent'` quedarian
igual (son correct, ya estan en SAP).
```

## Ejemplo mal documentado (anti-pattern)

```markdown
### v1172
- Fix FATECHI 2.0 prevention
```

Esto NO sirve. Falta: que archivo, que problema real, codigo antes/despues, por que, como verificar. Un agente futuro lee esto y tiene que ir a git blame → leer el PR → leer el audit → leer FATECHI post-mortem. Horas perdidas por 3 minutos no invertidos en documentar.

## Mecanica obligatoria por commit

Antes de `git commit`, verificar:

1. ✅ El cambio esta documentado en el lugar correcto (README §41 o docs/CHANGELOG-* o docs/AUDIT-*).
2. ✅ Las 5 secciones (Antes / Problema / Cambio / Por que / Verificacion) estan completas.
3. ✅ Si hay precedente (bug previo, incident, feedback stakeholder) → mencionado con fecha + nombre.
4. ✅ Si hay impacto $$$ → cuantificado con numeros reales.
5. ✅ Rollback instructions presentes si el cambio es sensible.
6. ✅ README §41 bumpeado con bullet rapido + link al doc extendido.

Si falta cualquier item → NO commit. Completar primero.

## Verificacion para quien lee despues

Cuando un futuro agente llega al repo y quiere entender un cambio:

1. Lee `README.md §41 Changelog` buscando la version X.
2. Si el bullet apunta a `docs/CHANGELOG-*` o `docs/AUDIT-*`, lee ese doc.
3. Encuentra las 5 secciones completas → entiende contexto en 2 min.
4. Si falta algo → marcar como "deuda de documentacion" + no replicar el pattern.

**Nunca** confiar solo en el commit msg. **Nunca** confiar solo en comentarios del codigo. El doc dedicado es la fuente de verdad.

## Integracion con CLAUDE.md

Ver CLAUDE.md §30 — regla referenciando esta skill.

## Precedentes de documentacion que SI sirvieron

Buenos ejemplos para calcar:
- `docs/plans/2026-08-07-mobile-bottom-nav-plan.md` — plan upfront con fases + gates
- `docs/specs/2026-09-18-mercadolibre-crm-section-design.md` — spec de feature con rollback
- `README.md §41 v735-v746` — plan Dark Mode con bullets detallados
- `CHANGELOG-ARCHIVE-v204-v299.md` — algunos entries con "Antes/Ahora" explicit

Buenos ejemplos de post-mortem:
- `project_audit_bo_2026-10-05` (memoria) — audit con 3 agents paralelos + resolucion
- CLAUDE.md §22 — gcloud logging diagnosis (precedente que nos ahorro ~2h)
- CLAUDE.md §24 — SAP SL no soporta $expand (precedente FATECHI-adjacent)
