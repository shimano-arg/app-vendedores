# Fallos conocidos de la suite `tests/rules/` — contexto integración D2/SEC-04/D3

Estos fallos de `tests/rules/rules.test.js` son **preexistentes en `main`** (no los
introduce la integración D2/SEC-04/D3) y **no son riesgos de seguridad** de esta
integración. Se documentan acá; su corrección va en **otra etapa**, no en la rama
`sec/integ-d2-sec04-d3-v1552`.

Verificado contra baseline: la suite falla los mismos tests sobre `origin/main`
puro (165 passed / 6 failed / 171 en `rules.test.js`). Tras el ciclo 17, el test
"entre vendedores" dejó de fallar (se actualizó a la semántica D2), quedando los
5 de abajo.

## F17 — `client_applications` alta pública anónima

- **Test**: `rules.test.js` → `permite crear client_applications via submittedByPublicForm (alta pública)`.
- **Qué comprueba**: que el formulario público (`alta-cliente.html`, sin auth) pueda crear un alta.
- **Por qué falla**: dato de test desalineado con el endurecimiento **v1172**. El test
  envía `cuit: '20-12345678-9'` (con guiones); la regla exige
  `cuit.matches('[0-9]{11}')` (11 dígitos sin separadores) → denegada. La regla es
  **más estricta** que el test.
- **¿Riesgo de seguridad?** No por D2/SEC-04/D3. La regla rechaza correctamente un
  CUIT malformado.
- **Nota funcional aparte (a verificar)**: si el formulario real envía el CUIT con
  guiones, v1172 podría estar bloqueando el alta pública legítima. Requiere
  verificación independiente del front `alta-cliente.html` (fuera de esta rama).
- **Resolución**: otra etapa. Alinear el dato del test (y, si corresponde, el front)
  con el formato `[0-9]{11}`. Regla idéntica a `main`; no se toca acá.

## seguimiento_* — 4 tests obsoletos (colecciones eliminadas en v1283)

Las colecciones `seguimiento_notes` y `seguimiento_status` **fueron eliminadas en
v1283 (2026-10-20)**, cuando el modal Seguimiento se reemplazó por "Análisis de
Cartera" (`cartera_vendor`). `firestore.rules` ya **no tiene** bloque `match` para
ellas (solo un comentario que documenta el borrado) → cualquier acceso cae en
default-deny ("No matching allow statements"). Los 4 tests que fallan son los que
esperan acceso permitido (`assertSucceeds`); los 2 `assertFails` del mismo bloque
pasan, justamente por el default-deny.

Tests que fallan (todos en `rules.test.js`, bloque `describe('/seguimiento_*')`):

1. `interno/gerente/admin leen` — espera lectura permitida; colección inexistente → deny.
2. `interno crea nota con authorUid propio` — espera create permitido → deny.
3. `interno solo edita/borra sus propias notas` — espera update propio permitido → deny.
4. `seguimiento_status: mismo patrón, cada VDI ve/edita el suyo por cliente` — espera create permitido → deny.

- **¿Riesgo de seguridad?** No. El default-deny sobre colecciones inexistentes es el
  comportamiento correcto.
- **Resolución**: test-cleanup en otra etapa — borrar el bloque `describe('/seguimiento_*')`
  completo (es código muerto que debió eliminarse junto con v1283). No se toca acá.

## Resumen

| # | Test | Causa | Riesgo seguridad | Acción |
|---|---|---|---|---|
| 1 | `client_applications … submittedByPublicForm` | CUIT con guiones vs regex `[0-9]{11}` (v1172) | No | Otra etapa (dato test / verificar front) |
| 2 | `seguimiento_* interno/gerente/admin leen` | colección eliminada v1283 → default-deny | No | Test-cleanup otra etapa |
| 3 | `seguimiento_* interno crea nota` | ídem | No | Test-cleanup otra etapa |
| 4 | `seguimiento_* interno edita/borra propias` | ídem | No | Test-cleanup otra etapa |
| 5 | `seguimiento_status mismo patrón` | ídem | No | Test-cleanup otra etapa |
