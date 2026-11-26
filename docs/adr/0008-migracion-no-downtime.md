# ADR-0008: Estrategia de migración de modelo de datos sin downtime

- **Status**: Proposed (2026-11-26) — requiere decisión Mariano.
- **Decididores**: Mariano (owner técnico) + gerencia (owner negocio por cronograma).
- **Supersede**: ninguno. Formaliza el pattern que hoy se aplica ad-hoc (precedente v1397, v1402, v1412 — migraciones chicas con snapshot `_backfill`).
- **Relacionado**: ADR-001 (nuevo modelo de datos `pedido_lines` + `stock_reservations`, Proposed), ADR-009 (feature flags, Accepted 2026-11-25).

## Contexto

Hoy cada pedido guarda sus líneas (SKU + cantidad + reserva de stock) dentro del mismo documento `pedidos/<id>` (campo `lines[]`). El plan técnico ADR-001 propone separarlas en documentos propios (`pedido_lines/<id>` + `stock_reservations/<id>`). **No existe un plan formal para ejecutar ese cambio con la app corriendo.** Hoy en prod hay:

- ~710 pedidos abiertos (`state in {pending, confirmed}` sin `closedAt`).
- ~2.000 escrituras por día a `/pedidos` (triggers + CFs + usuarios).
- 3 triggers Cloud Functions activos sobre `/pedidos` que recalculan snapshots, envían a SAP, y observan mutaciones de líneas.

Si la migración falla a mitad, los vendedores quedan sin poder operar (commit rebotado, stock inconsistente, pedidos a medias). Migraciones chicas anteriores (ej. v1486 backfill de 486 pedidos createdAt Timestamp → ISO, §71; v1412 backfill vendor master, §44) salieron bien con snapshot `_backfill` y rollback reversible — pero ninguna tocó el shape del campo `lines[]`, que es el core del modelo.

## Decisión propuesta

Para ejecutar ADR-001 (nuevo modelo), adoptar **Opción B — doble escritura con flag de lectura**. No es decisión final: ADR-001 todavía está Proposed y ADR-008 queda bloqueado hasta que el modelo nuevo se firme. Lo que ADR-008 fija HOY es el **pattern** que se usará cuando se decida migrar.

### Tres opciones evaluadas

**Opción A — "Big bang" con red de seguridad (status quo).** Un script corre, convierte todo de una vez, guarda snapshot `_backfill` por doc (§55). Si falla, un script de reversión itera los snapshots y restaura. Costo 0 inicial. **Riesgo alto** con 710 pedidos abiertos + 2k writes/día: la ventana entre "read de doc viejo" y "write de doc nuevo" puede durar segundos; cualquier escritura concurrente (VDE confirmando, trigger SAP, reconcile) sobre la copia vieja se pierde.

**Opción B — Doble escritura + flag de lectura (RECOMENDADA).** Durante 2–4 semanas:
1. La app **escribe en los dos modelos** (viejo `pedidos.lines[]` + nuevo `pedido_lines/*` + `stock_reservations/*`) en cada mutación.
2. Un test automático nocturno compara los dos modelos (`scripts/audit/dual_write_parity.cjs`) y reporta divergencias.
3. Cuando 7 días seguidos dan paridad exacta, un feature flag (`dual_write_cutover`, patrón ADR-009) flipea la **lectura** al modelo nuevo.
4. Si algo falla, el flag se flipea de vuelta en 1 minuto. Las escrituras siguen dobles hasta que se decida apagar la vieja.

Costo extra: 3–4 semanas-persona de wire + doble escrituras en Firestore durante la ventana (∼2× el tráfico actual sobre `/pedidos`, ~4k writes/día). Riesgo medio controlado.

**Opción C — Tráfico gradual (10% → 50% → 100% por usuario).** Pattern de empresas grandes (Google, Netflix) con millones de users. Para 15 vendedores + 2k writes/día es **sobredimensionado**: 6–8 semanas-persona + infraestructura de bucketing por usuario sin beneficio proporcional.

### Pattern obligatorio cuando se apruebe la migración

Toda migración futura que toque shape de doc de `/pedidos` o `/revision_waitlist` debe cumplir:

1. **Doble escritura primero**: 2–4 semanas con el pure helper que escribe en ambos modelos. El código viejo sigue siendo la fuente de verdad para lecturas.
2. **Audit nocturno de paridad**: script `scripts/audit/dual_write_parity_<topic>.cjs` corre cada noche, compara los dos modelos, escribe reporte a `operations_log` con `type='dual_write_parity_check'`. 0 divergencias por 7 días consecutivos habilita el cutover.
3. **Flag de cutover**: un feature flag (ADR-009) controla qué modelo se lee. Default `false` (lee viejo). Flip a `true` lee nuevo. Rollback = 1 toggle.
4. **Snapshot `_backfill`**: cada doc migrado guarda el shape previo (§55). Reversible.
5. **Pure helpers §57**: la lógica de escribir ambos modelos vive una sola vez en `src/pure/` con espejo en `functions/core/`. Test de sincronía obligatorio.
6. **Fail-open en lecturas**: si el modelo nuevo está vacío o malformado (migración parcial, flag ON prematuro), la lectura degrada al modelo viejo + log warning. Nunca bloquear al usuario.
7. **Verificación en VDE real** antes del cutover: checklist §90.

## Consecuencias

### Bueno

- Rollback inmediato (toggle flag) si el modelo nuevo tiene bug de lectura.
- Zero downtime para los vendedores: siempre hay un modelo operativo.
- Divergencias se detectan en el audit nocturno antes de impactar producción.
- El pattern aplica a futuras migraciones (`/revision_waitlist`, `/reparto`, etc.) sin replantear.

### Malo

- +3–4 semanas al cronograma de ADR-001.
- +50-100% escrituras en Firestore durante la ventana (costo chico: céntimos de dólar, dentro del tier razonable).
- Deuda temporal: código que escribe dos modelos es más complejo. Hay que retirar la doble escritura post-cutover (paso aparte, ~1 semana).
- Aumenta el surface de bugs mientras dura la doble escritura. Mitigado por el audit nocturno y los pure helpers con sync test.

### Lo que NO cambia

- Vendedores no notan nada: la UX es idéntica.
- Rules Firestore se extienden a las colecciones nuevas, no cambian las vigentes.
- SAP integration, Panel Control, reparto, waitlist siguen operando sin ajuste.

## Qué invalidaría la recomendación

- **Volumen cae 10×**: si Shimano baja a <50 writes/día, Opción A alcanza.
- **ADR-003 ambiente de staging** se shippea antes: habilitaría probar la migración en staging con dataset real sin impactar prod. En ese caso Opción A pasa a ser viable.
- **ADR-001 se descarta**: si el modelo actual se queda, ADR-008 no se activa nunca. Queda como pattern de referencia.

## Verification

Este ADR no genera scripts ni tests directo — es un pattern. Cuando ADR-001 pase a Accepted y arranque la implementación, cada paso que ejecute el pattern debe:

- Pasar por un plan `docs/superpowers/plans/<fecha>-migracion-<topic>.md`.
- Tener audit script en `scripts/audit/dual_write_parity_<topic>.cjs`.
- Tener tests pair en `tests/unit/audit/dual-write-parity-<topic>.test.js` + `tests/unit/audit/cutover-flag-<topic>.test.js`.
- Documentar en CLAUDE.md una sección nueva que describa la migración concreta.

Audit genérico para detectar que todo plan de migración sigue el pattern: `scripts/audit/migration_pattern_compliance.cjs` (pendiente — se agrega cuando se arranca la primera migración real).

## Pendiente de Mariano

1. Confirmar que la Opción B es aceptable como pattern default.
2. Firmar o rechazar cuando ADR-001 se habilite.
3. Confirmar si quiere `docs/superpowers/plans/` o `docs/plans/` como ruta canónica del plan específico.
