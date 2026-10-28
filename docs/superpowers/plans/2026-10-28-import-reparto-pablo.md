# Plan: Import Reparto Pablo (v1511+)

**Pedido original** Mariano 2026-10-28: 3 ajustes + 1 validación completa + Playwright + usuario de prueba + verif prod + informe + unit tests + e2e tests, en 1 PR.

**Estado**: dividido en **2 fases** por tamaño realista.

---

## Fase 1 — v1511 (ESTE PR) — Ajustes mínimos

**Deliverable**: destrabar prod + limpieza del botón que ya no se usa.

### ✅ T1. Fix bug "Cargando ingresos pending…" eterno

- **Diagnóstico**: `_handlerRep` en `_repartoSubscribe` (`index.html:21683+`) rechazaba todos los snapshots `fromCache=true` cuando online (política §103 v1501). Si el primer snapshot era cache, `_repartoRender()` nunca se llamaba → modal trabado.
- **Fix**: siempre renderear el primer snapshot (sea cache o server) para quitar el loader; a partir del 2do aplicar política offline-aware normal. El timestamp del snapshot server se trackea aunque sea el primero.
- **Archivos**: `index.html` `_handlerRep` (líneas ~21696-21720).

### ✅ T2. Quitar botón "Exportar reporte"

- Removido: markup + handler + stub + 15 tests.
- Preservado: `src/pure/reparto-export-rows.js` (shape rows aún usado por otros exports indirectamente).
- Verificado: NO hay consumidor externo documentado. El reporte era read-only; el user que lo descargaba era el que abría el modal.
- **Archivos**: `index.html`, `src/domains/exports-core.js`, `src/main.js`, `tests/unit/audit/reparto-export-v1492.test.js` (deleted).

---

## Fase 2 — v1512 (PR follow-up) — Flow completo Pablo

### ⏳ T3. UI vista previa Import — resumen 3 números + tabla 5 columnas + regla consistencia

**Scope**: rework del modal preview que muestra `#reparto-import-modal` tras subir el Excel.

**Cambios UI**:

1. **Resumen** (hoy dice "5 cambio(s), 6 u asignadas, 0 u eliminadas"): pasa a **3 números centrados y únicos**:
   - Unidades **asignadas** (Σ Asignado).
   - Unidades que **vuelven a backorder** (Σ Vuelve a BO).
   - Unidades **eliminadas** (Σ Eliminar).
2. **Cards arriba** (Reconocidas, Con cambios, Errores) se mantienen pero **centradas** (títulos + valores).
3. **Tabla filas** → 5 columnas: **SKU, Cliente, Asignado, Vuelve a BO, Eliminado**. Sacar la columna "BO" del detalle.
4. **Regla de consistencia por fila**:
   - `Asignado + VuelveABO + Eliminado === backorderActualCliente+SKU`
   - Si no coincide: fila `error`, boton "Aplicar" **disabled**.
   - Error en lenguaje simple (§68): "Las unidades no cierran con lo pedido en back order."

**Archivos**:
- `src/pure/reparto-excel-import-validator.js`: extender validador con los 3 totales + regla por fila.
- `src/domains/exports-reparto.js`: render preview actualizado.
- `tests/unit/reparto-excel-import-validator.test.js`: extender con el caso SE1000FJ (5 filas, 6 asignadas, 0 BO, 0 eliminadas) + 1 fila con eliminadas > 0 + 1 fila con VuelveABO > 0 + regla de consistencia.

### ⏳ T4. Validar Pablo (gerente) de punta a punta

**(a)** Pablo ve los botones Exportar/Importar Excel → verificar rules + role.

**(b)** Firestore rules + `applyRepartoManualCF` SEC-CF-010:

- Gate SEC-CF-010 vive en `functions/core/reparto-core.js` (grep "SEC-CF-010" o email `pablo.gonzalez@shimano.com.ar`).
- `origen='import'` no debería tener un gate adicional; debe pasar por el mismo que `origen='manual'`.
- Verificar que role=gerente pasa (admin/gerente/interno OR email hardcodeado).
- **PENDIENTE**: investigar + reportar + fixear si hay bloqueo.

**(c)** Round-trip Pablo: exporta → re-sube sin tocar → debe dar 0 cambios y 0 errores.

**(d)** Pablo edita Excel con 2 asignaciones + 1 eliminación → aplica → `reparto_log` entry con `uid=Pablo.uid`, `origen='import'`.

**(e)** Archivo inválido (Asignado > Stock disponible) → error §68 en lenguaje simple + 0 escrituras.

### ⏳ T5. Crear user `pruebas.gerente@shimano.com.ar`

- Script `scripts/setup/create_gerente_test_user.cjs` (análogo a `scripts/setup/create_e2e_test_user.cjs`).
- Role: `gerente`. gcloud secrets: `test-gerente-email` + `test-gerente-password`.
- Cliente test: `e2e-test-client-gerente` (cardCode `CE2EGERENTE01`).
- Extender `tests/e2e/helpers/load_creds.js` con `loadE2eCreds(suffix)` opcional.
- Doc en app_config/e2e_test_users.

### ⏳ T6. Playwright E2E 5 puntos Pablo + "Exportar reporte no existe"

Spec nueva: `tests/e2e/s_import_reparto_pablo.spec.js`:
- S1. Pablo loguea → ve botones Exportar/Importar Excel en Reparto.
- S2. Pablo exporta → re-sube sin tocar → 0 cambios + 0 errores.
- S3. Pablo edita (2 asig + 1 elim) → aplica → verif `reparto_log` entry con origen=import + uid.
- S4. Pablo sube inválido (Asignado > stock) → error §68 + no aplica.
- S5. Grep del modal: "Exportar reporte" NO existe en DOM.

### ⏳ T7. Ciclo Excel desktop manual (Windows)

- Verif que Excel desktop no rompe el parser (celdas tipos, fórmulas, codificación).
- Si rompe: parchear `src/pure/reparto-excel-import-validator.js` + unit test cobertura.

### ⏳ T8. Verificación prod + informe

- Deploy solo lo tocado (functions solo si cambié CF).
- Verif con `pruebas.gerente@shimano.com.ar` en prod.
- 3 capturas: cabecera (sin Exportar reporte), vista previa (resumen 3 nums), resultado.
- Informe `Desktop\INFORME_IMPORT_REPARTO_PABLO.md`: qué puede/no puede Pablo, diffs admin/gerente, qué hacía el reporte eliminado.

---

## Decisiones

- **Fase 1 (hoy)**: entregamos los 2 fixes críticos sueltos (T1 bug + T2 clean) para destrabar el modal Reparto que está trabado en prod.
- **Fase 2 (próxima iteración)**: PR follow-up con T3-T8. Requiere más tiempo porque: crear user Firebase Auth + 1 Playwright spec con 5 puntos + verif Excel desktop + verif prod + informe. Dividir evita entregar algo parcial que requiera backtracking.

## Rollback

- Fase 1 (v1511): `git revert <sha>` + redeploy ~2 min. Vuelve a v1510 con "Exportar reporte" presente + bug "Cargando..." activo.
- Fase 2 (v1512, cuando se haga): rollback por punto según impacto. User `pruebas.gerente` sobrevive al revert (no se auto-borra); el secret tampoco.
