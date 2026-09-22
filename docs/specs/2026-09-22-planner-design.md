# Sección PLANNER en app-vendedores — Design Spec

**Fecha**: 2026-09-22
**Autor**: Mariano Erbino + Claude (brainstorming session)
**Estado**: Draft — pendiente revisión de usuario
**Repo**: `shimano-arg/app-vendedores`

---

## 1. Objetivo

Nueva sección **Planner** tipo Kanban que expone el flujo de un pedido de punta a punta en 6 columnas, con responsables por columna, emails automáticos al pasar entre columnas, y adjuntos por tarjeta.

Muestra el ciclo real: Lista de Espera → Oferta SAP → Orden SAP → Confirmado (validación Mariano) → Facturar → Cobrado.

**Fuera de scope MVP (fase 1)**:
- Sync automático SAP `Orders` → `pedidos.transferidoSAP.orderDocEntry`. Fase 2.
- Sync automático cobranza SAP `Invoices.PaidToDate` → `pedidos.paidStatus`. Fase 3.
- Acceso para roles distintos de Mariano. Se abre gradualmente cuando el flujo esté validado.

---

## 2. Audiencia y permisos

**Fase de desarrollo (actual)**: solo Mariano (`erbinomariano@gmail.com` o `mariano.erbino@shimano.com.ar`) ve la sección. Gate doble como Panel de Control (v611+): email whitelist en frontend + `userRole === 'admin'` + rules Firestore.

**Post-validación (roll-out planificado)**:
- `admin` / `gerente` / Mariano: ven todos los pedidos.
- `vendedor` (VDI): ve solo pedidos de su cartera (filtro Firestore rules por `vendorKey`).
- `vendedor` (VDE): sin acceso al Planner (siguen usando Lista de Espera actual).

El flip se hace con un feature flag en `app_config/planner_config.enabledForAllRoles` (default `false`).

---

## 3. Arquitectura y 3 fases

```
┌──────────────────────────────────────────────────────────────────┐
│ FASE 1 — Kanban shell + movimiento manual (esta iteración)        │
│  · Nuevo pane-planner con sub-tabs Tablero + Config               │
│  · Card = doc pedidos (columna derivada via computeColumn)        │
│  · Nuevos campos plannerStage, plannerHistory, plannerEmails,     │
│    plannerAttachments                                             │
│  · Nueva CF onPlannerStageChanged (Firestore trigger onWrite)     │
│  · Storage /planner-attachments/{pedidoId}/{ts}_{filename}        │
│  · Config responsables en app_config/planner_responsables         │
│  · Órdenes/Confirmado/Cobrado se mueven a mano (drag-drop)        │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ FASE 2 — syncSapOrdersToApp (~1 sesión adicional)                  │
│  · Nueva CF scheduled cada 15 min (análoga a syncSapInvoicesToApp) │
│  · Lee /Orders SAP, matchea Quotations por BaseType=23             │
│  · Persiste transferidoSAP.orderDocEntry en pedido                 │
│  · Auto-transición Oferta → Órdenes                                │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ FASE 3 — Sync cobranza (~1 sesión adicional)                       │
│  · Amplía syncSapInvoicesToApp con PaidToDate + DocTotal           │
│  · Calcula paidStatus: 'unpaid' | 'partial' | 'paid'               │
│  · Auto-transición Facturar → Cobrado                              │
└──────────────────────────────────────────────────────────────────┘
```

Fase 1 entrega el tablero funcional end-to-end desde el día uno. Fases 2 y 3 sacan el trabajo manual de mover cards en las 3 columnas de la derecha.

---

## 4. Modelo de datos

### 4.1 · `pedidos/{id}` — campos nuevos

Whitelist `hasOnly` en `firestore.rules` (precedente v776 + v859):

```javascript
{
  // ... campos existentes intactos ...

  // Override manual del cómputo automático de columna.
  // null = usar computeColumn(pedido) derivado del estado real.
  plannerStage: null | 'confirmado' | 'cobrado_parcial' | 'cobrado_full',

  // Historial de transiciones de columna. Append-only.
  plannerHistory: [
    { stage: 'confirmado', movedAt: Timestamp, movedBy: uid, movedByEmail: 'x@y' },
    ...
  ],

  // Idempotencia de emails: si sentAt existe, no re-envía.
  plannerEmails: {
    lista_espera: { sentAt: Timestamp, to: 'x@y' },
    oferta:       { sentAt, to },
    ordenes:      { sentAt, to },
    confirmado:   { sentAt, to },
    facturar:     { sentAt, to },
    cobrado:      { sentAt, to },
  },

  // Adjuntos. Máx 10 items enforced client-side + CF.
  plannerAttachments: [
    {
      name: 'remito.pdf',
      url: 'https://storage.../planner-attachments/{id}/{ts}_remito.pdf',
      size: 234567,
      mime: 'application/pdf',
      uploadedAt: Timestamp,
      uploadedBy: uid,
    },
    ...
  ],

  // Solo poblado en fase 3.
  paidStatus: 'unpaid' | 'partial' | 'paid',
  paidAmount: number,    // ARS
  paidToDate: Timestamp,
}
```

### 4.2 · `app_config/planner_responsables` (singleton, id `planner_responsables`)

```json
{
  "lista_espera": { "email": "...", "name": "...", "notifyOnEnter": true },
  "oferta":       { "email": "...", "name": "...", "notifyOnEnter": true },
  "ordenes":      { "email": "...", "name": "...", "notifyOnEnter": true },
  "confirmado":   { "email": "mariano.erbino@shimano.com.ar", "name": "Mariano", "notifyOnEnter": true, "hardcoded": true },
  "facturar":     { "email": "...", "name": "...", "notifyOnEnter": true, "sendToVdi": true },
  "cobrado":      { "email": "...", "name": "...", "notifyOnEnter": true }
}
```

Notas:
- `confirmado` es el único con `hardcoded: true` — el destino ("Mariano valida") no es configurable.
- `facturar.sendToVdi: true` significa "adicionalmente al responsable configurado, envía email al VDI del pedido" — así se implementa el email al VDI cuando la mercadería sale de Confirmado hacia Facturar.
- Todos los campos son read por rules `isMariano() || isAdmin()`, write solo `isMariano()`.

### 4.3 · `app_config/planner_config` (singleton, feature flags)

```json
{
  "enabledForAllRoles": false,
  "syncOrdersEnabled": false,    // flip cuando fase 2 esté deployed
  "syncCollectionsEnabled": false // flip cuando fase 3 esté deployed
}
```

### 4.4 · `roles/{uid}` — campo agregado

Necesario para columna Confirmado → Facturar (email al VDI del pedido):

```javascript
{
  // ... campos existentes intactos ...
  email: 'vdi@shimano.com.ar',  // NUEVO — expuesto para resolver destinatario
}
```

Populated por Cloud Function extendida `setUserRoleCF` en el momento de asignar el rol. Read: `isAdmin() || isGerente() || isMariano()`. Write: solo la CF.

### 4.5 · `computeColumn(pedido)` — algoritmo derivador

Función pura client-side + server-side (dupe en CF). Prioridad top-down:

```javascript
function computeColumn(pedido) {
  // 1. Override manual gana siempre
  if (pedido.plannerStage === 'confirmado') return 'confirmado';
  if (pedido.plannerStage === 'cobrado_parcial') return 'cobrado';
  if (pedido.plannerStage === 'cobrado_full') return 'cobrado';

  // 2. Cobranza (fase 3)
  if (pedido.paidStatus === 'partial' || pedido.paidStatus === 'paid') return 'cobrado';

  // 3. Facturación
  const anyInvoiced = pedido.items?.some(l => (l.qtyInvoiced || 0) > 0);
  if (anyInvoiced) return 'facturar';

  // 4. Orden SAP (fase 2)
  if (pedido.transferidoSAP?.orderDocEntry) return 'ordenes';

  // 5. Oferta SAP
  if (pedido.transferidoSAP?.docNum) return 'oferta';

  // 6. Default: Lista de espera
  return 'lista_espera';
}
```

Fase 1 hace que las columnas Órdenes, Confirmado (parcialmente) y Cobrado solo se llenen si Mariano las mueve a mano (via `plannerStage` override). Fase 2 activa 4. automático. Fase 3 activa 2. y 3. automático.

---

## 5. UI

### 5.1 · Registro del pane

**Nuevo pane** `pane-planner` post-Rendiciones en `index.html` (~línea 4950). Botón tab en la nav principal:

```html
<button class="tab-btn" data-tab="planner" onclick="setTab('planner')">Planner</button>
```

Gate CSS (fase de desarrollo Mariano-only) — precedente Panel de Control:

```css
.tab-btn[data-tab="planner"] { display: none; }
body.is-mariano .tab-btn[data-tab="planner"] { display: inline-block; }
```

`body.is-mariano` se setea en `applyRolePermissions()` (línea ~23140) cuando `token.email` está en whitelist Mariano.

### 5.2 · Sub-tabs internos

Dos sub-tabs siguiendo el pattern `rd-subtabs`:
- **Tablero** (default) — el Kanban.
- **Config** (solo Mariano, hardcoded) — edición de `planner_responsables`.

### 5.3 · Layout Kanban

6 columnas horizontales, scroll horizontal en mobile. Estilo Apple:

- **Materiales translúcidos**: columnas con `backdrop-filter: blur(20px)` sobre background sutil.
- **Motion**: spring animations en drag-drop (`cubic-bezier(0.32, 0.72, 0, 1)`), duración 320ms. Respeta `prefers-reduced-motion`.
- **Typography**: SF Pro Display / Inter, tracking negativo en headers, leading generoso.
- **Feedback**: haptic-like scale-up al drag (`scale(1.02)`), drop-zone highlight con outline animado.

**Header por columna**:
- Nombre columna (large title, tracking tight).
- Count de cards (badge secundario).
- Avatar + email del responsable (chip translúcido, hover expande).
- Botón "Ping" (Mariano only) — reenvía el último email pendiente.

**Card compacta** (ordenada por `updatedAt desc`):
```
┌─────────────────────────────────────┐
│ ARANDANO — Sport Bike Store         │  ← Cliente
│ 🚴 VDI Diego · 12/09 · $340,000     │  ← VDI · Fecha · Total
│ [SAP:12345] [SO:678] [📎3]          │  ← Badges
└─────────────────────────────────────┘
```

- Fondo/borde: color según sub-estado (ver §5.4).
- Click abre modal detalle (§5.5).
- Drag-drop entre columnas (interruptible, spring physics).
- Botón "Avanzar →" fallback para touch (solo aparece si hover >500ms o dispositivo touch).

### 5.4 · Sub-estados y colores por columna

| Columna | Sub-estados | Color card |
|---|---|---|
| **Lista de espera** | Cargado / Confirmado por vendedor | Amarillo / Verde |
| **Oferta** | (único) | Azul suave |
| **Órdenes** | (único) | Púrpura suave |
| **Confirmado** | (único) | Naranja suave |
| **Facturar** | Pendiente / Facturado | Amarillo / Verde |
| **Cobrado** | Parcial / Full | Naranja / Verde |

Colores usan la escala del design system existente (dark mode compliant, WCAG AA — precedente v746 dark mode).

### 5.5 · Lista de espera — 2 botones toggle

En cada card de la columna Lista de espera, dos botones inline:

```
[  ● Cargado  ][  Confirmado por vendedor  ]
```

Toggle setea `revision_waitlist/{id}.vendorConfirmed = true/false`. El botón activo tiene fondo lleno (yellow/green), el inactivo es outline. El pase efectivo a Oferta lo dispara `onPedidoConfirmedSendToSap` cuando admin envía a SAP (flujo existente, no lo tocamos).

### 5.6 · Modal detalle

Al hacer click en una card, se abre modal fullscreen (mobile) o centered (desktop) con 3 tabs:

**Tab Líneas**: tabla read-only con las líneas del pedido (SKU, cantidad, qtyInvoiced, precio, subtotal).

**Tab Adjuntos**:
- Grid de miniaturas (PDFs con icono, JPG/PNG con thumbnail).
- Botón "Subir archivo" (multipart, drag-drop area).
- Contador "3 / 10" en la esquina.
- Click en adjunto → abre en tab nueva (usa `getDownloadURL`).
- Botón "Eliminar" per-adjunto (solo Mariano/admin en fase actual).

**Tab Historial**:
- Timeline vertical con transiciones (`plannerHistory` renderizado).
- Cada entry: quién movió, cuándo, a qué columna.
- Emails enviados: entry con "📧 Email enviado a X" + timestamp.
- Botón "Reenviar notif de columna actual" (idempotencia se resetea manualmente).

### 5.7 · Sub-tab Config (Mariano-only)

Formulario simple con 6 rows (una por columna), cada una con:
- Nombre columna (readonly).
- Input email del responsable.
- Toggle "Notificar cuando entre a esta columna".
- (Solo en Confirmado): mensaje "Hardcoded a Mariano — no editable".
- (Solo en Facturar): toggle "Además enviar email al VDI del pedido".

Save: `updateDoc('app_config/planner_responsables', {...})`. Rules: solo Mariano.

---

## 6. Emails automáticos

### 6.1 · CF `onPlannerStageChanged`

Nueva Cloud Function Firestore trigger `onWrite pedidos/{id}`:

```javascript
// functions/index.js
export const onPlannerStageChanged = onDocumentWritten(
  { document: 'pedidos/{id}', region: 'southamerica-east1', secrets: [GMAIL_APP_PASSWORD] },
  async (event) => {
    return handlePlannerStageChanged(event, {
      fetch: globalThis.fetch,
      db: getFirestore(),
      transporter: buildNodemailer(GMAIL_APP_PASSWORD.value()),
      log: console,
    });
  }
);
```

Core lógica (`functions/core/planner-stage-change-core.js`), sigue pattern regla #7 CLAUDE.md:

```javascript
export async function handlePlannerStageChanged(event, deps) {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!after) return;  // delete, ignore

  const beforeCol = before ? computeColumn(before) : null;
  const afterCol = computeColumn(after);
  if (beforeCol === afterCol) return;  // no column change

  // Idempotencia: si ya se envió email para esta columna, skip.
  if (after.plannerEmails?.[afterCol]?.sentAt) return;

  // Resolver destinatario(s).
  const config = await deps.db.doc('app_config/planner_responsables').get();
  const columnConfig = config.data()?.[afterCol];
  if (!columnConfig?.notifyOnEnter) return;

  const recipients = [columnConfig.email];
  if (afterCol === 'facturar' && columnConfig.sendToVdi) {
    const vdiEmail = await resolveVdiEmail(after.vendorKey, deps.db);
    if (vdiEmail) recipients.push(vdiEmail);
  }

  // Enviar.
  await deps.transporter.sendMail({
    from: 'bot.shimano.pesca@gmail.com',
    to: recipients.join(','),
    subject: `[Planner] Pedido ${after.pedidoNumber} entró a ${labelFor(afterCol)}`,
    html: buildEmailBody(after, afterCol),
  });

  // Marca idempotencia.
  await event.data.after.ref.update({
    [`plannerEmails.${afterCol}`]: {
      sentAt: FieldValue.serverTimestamp(),
      to: recipients.join(','),
    }
  });
}
```

### 6.2 · Reenvío manual

Botón "Reenviar notif" en el modal (tab Historial) llama a Callable Function `resendPlannerEmailCF({pedidoId, column})`. Auth: Mariano/admin only. Efecto: borra `plannerEmails[column].sentAt`, dispara re-cálculo (o llama al core directamente).

### 6.3 · Templates

Sin sistema de templates externo (mismo criterio que `onQuotationSentNotify`). HTML inline en `buildEmailBody(pedido, column)`, con branding Shimano (logo, colores). Contenido:
- Subject: `[Planner] Pedido {pedidoNumber} entró a {labelColumna}`
- Body: tabla con Cliente, VDI, Total ARS, DocNum SAP si aplica, link directo al Planner en la app (`https://app-vendedores.web.app/?goto=planner&pedido={id}`).

---

## 7. Storage

**Path**: `/planner-attachments/{pedidoId}/{timestamp}_{sanitized_filename}`

**Reglas** (`storage.rules`):

```
match /planner-attachments/{pedidoId}/{fileName} {
  allow read: if request.auth != null && (
    isAdmin() || isGerente() || isMariano() ||
    (isVendedor() && ownsPedido(pedidoId))
  );
  allow write: if request.auth != null && (
    isAdmin() || isMariano()  // fase 1: solo Mariano sube
  )
  && request.resource.size < 10 * 1024 * 1024  // 10 MB
  && request.resource.contentType.matches('application/pdf|image/jpeg|image/png');
}
```

**Enforcement client-side**:
- Máx 10 archivos por pedido (contar `pedido.plannerAttachments.length` antes de permitir upload).
- MIME whitelist duplicado (feedback UX inmediato).
- Sanitización de nombre (`replace(/[^a-zA-Z0-9._-]/g, '_')`).

**Sin TTL/cleanup automático** en fase 1 (consistente con `/rendiciones`). Si crece, se agrega scheduled CF de cleanup en fase futura.

---

## 8. Firestore rules

Cambios en `firestore.rules`:

### 8.1 · `pedidos/{id}` — extender whitelist

Los 4 campos nuevos (`plannerStage`, `plannerHistory`, `plannerEmails`, `plannerAttachments`, `paidStatus`, `paidAmount`, `paidToDate`) se agregan al `hasOnly` existente. Write: Mariano/admin (fase 1), extendido en fase de rollout.

### 8.2 · `app_config/planner_responsables` — nueva

```
match /app_config/planner_responsables {
  allow read: if isAdmin() || isGerente() || isMariano();
  allow write: if isMariano();
}
```

### 8.3 · `app_config/planner_config` — nueva

```
match /app_config/planner_config {
  allow read: if request.auth != null;
  allow write: if isMariano();
}
```

### 8.4 · `roles/{uid}` — campo `email`

Read del campo `email` limitado a `isAdmin() || isGerente() || isMariano()`. Write solo Cloud Function (extended `setUserRoleCF`).

Tests: extender `firestore.rules.test.js` con casos para los 3 puntos anteriores.

---

## 9. Tests

### 9.1 · Unit tests

**`tests/unit/planner-compute-column.test.js`**:
- Pedido sin nada → `lista_espera`
- Pedido con `transferidoSAP.docNum` → `oferta`
- Pedido con `orderDocEntry` → `ordenes`
- Pedido con `plannerStage='confirmado'` → `confirmado`
- Pedido con `qtyInvoiced > 0` en 1 línea → `facturar`
- Pedido con `paidStatus='partial'` → `cobrado`
- Override manual gana sobre auto-cálculo.
- Edge: `qtyInvoiced === 0` + `docNum` set → `oferta` (no `facturar`).

**`tests/unit/planner-resolve-responsable.test.js`**:
- Columna estándar → email del config.
- Columna Confirmado → hardcoded Mariano.
- Columna Facturar con `sendToVdi=true` → devuelve [config.email, vdiEmail].
- VDI sin email en `roles/{uid}` → devuelve solo config.email + log warning.

**`tests/unit/planner-email-idempotency.test.js`**:
- Primera transición → envía.
- Segunda transición a la misma columna → skip.
- Reenvío manual (borra sentAt) → re-envía.

### 9.2 · Smoke tests

**`tests/smoke/bundle-runtime.test.js`**: verifica que las nuevas funciones no rompan globals (regla #15 CLAUDE.md, IIFE lazy init si aplica).

### 9.3 · Integration tests

**`tests/functions/planner-stage-change.test.js`**:
- Mock nodemailer + mock Firestore.
- Simula onWrite con columna cambiada → verifica sendMail llamado con params correctos.
- Simula onWrite sin cambio → verifica sendMail NO llamado.
- Simula error en sendMail → verifica que log ocurre pero no crashea la CF.

### 9.4 · Rules tests

Extender `firestore.rules.test.js` con:
- Mariano puede leer/escribir `planner_responsables`.
- Admin no-Mariano NO puede escribir `planner_responsables`.
- VDE no puede leer campo `email` en `roles/`.

---

## 10. Deploy plan (fase 1)

Etapas ejecutables como plan Loop:

**E0 — Bump versión + docs**:
- `APP_VERSION` en `index.html` a `v1004`.
- `CACHE_VERSION` incrementar.
- README §XX nueva sección "Planner (Mariano-only en desarrollo)".
- Commit inicial.

**E1 — Rules + data model**:
- Agregar campos a whitelist `pedidos` en `firestore.rules`.
- Agregar rules para `app_config/planner_responsables` + `planner_config`.
- Agregar rule para campo `email` en `roles/{uid}`.
- Extender `firestore.rules.test.js`.
- Deploy rules.

**E2 — Storage rules**:
- Agregar path `/planner-attachments/` en `storage.rules`.
- Deploy storage rules.

**E3 — Cloud Function `onPlannerStageChanged`**:
- `functions/core/planner-stage-change-core.js` (pure logic, deps inyectables).
- `functions/index.js` wrapper.
- Unit tests core.
- Integration test.
- Deploy CF: `firebase deploy --only functions:onPlannerStageChanged`.

**E4 — CF `resendPlannerEmailCF`** (callable):
- Core + wrapper.
- Deploy.

**E5 — UI shell del Planner**:
- Nuevo botón tab.
- Nuevo `pane-planner` con estructura básica.
- Sub-tabs Tablero + Config.
- Gate CSS Mariano-only.
- 3 listeners `onSnapshot` + registro en `detachFirebaseListeners()` (regla #12).

**E6 — UI Kanban**:
- 6 columnas, cards compactas, drag-drop.
- Estilo Apple (glass, spring animations, dark mode compliant).
- Botones toggle Lista de espera.
- Botón "Avanzar →" fallback touch.

**E7 — UI Modal detalle**:
- Tabs Líneas / Adjuntos / Historial.
- Upload Storage.
- Timeline plannerHistory.
- Botón reenviar notif.

**E8 — UI Config responsables**:
- Formulario 6 rows.
- Save a `app_config/planner_responsables`.

**E9 — Smoke test manual + versión final**:
- Mariano prueba end-to-end.
- Move card entre columnas → verifica email.
- Sube adjuntos → verifica Storage + URL en Firestore.
- Bump `v1005` si todo OK.
- Merge dev → main (workflow rama dev + PR squash, memory `feedback_app_vendedores_dev_branch`).

**Fase 2** (sesión aparte): `syncSapOrdersToApp` CF.

**Fase 3** (sesión aparte): sync cobranza vía `syncSapInvoicesToApp` extendida.

---

## 11. Riesgos y decisiones abiertas

### 11.1 · Riesgos

**R1: Email al VDI requiere email en `roles/{uid}`**  
Hoy `roles` NO tiene `email`. Hay que backfillear + extender `setUserRoleCF`. Riesgo: VDIs viejos sin email hasta que se actualicen. Mitigación: al enviar email de Facturar, si el VDI no tiene email, log warning + email solo al responsable configurado (no bloquea).

**R2: Idempotencia y regresión de columna**  
Si un pedido pasa por Confirmado, se registra email. Si Mariano lo mueve *back* a Órdenes y después re-avanza, `plannerEmails.confirmado.sentAt` sigue seteado → no re-envía. Diseño intencional: reenvío es explícito via botón. Riesgo: usuario espera re-notificación automática. Mitigación: documentar en tooltip del botón "Reenviar notif".

**R3: Drag-drop en mobile + scroll horizontal**  
Interacción compleja. Riesgo: drag-drop se confunde con scroll. Mitigación: long-press (500ms) para iniciar drag en touch, fallback botón "Avanzar →" siempre visible.

**R4: `computeColumn` dupe client + server**  
La lógica está en 2 lenguajes (JS bundle + CF). Riesgo: drift. Mitigación: extraer a `functions/core/planner-compute-column.js` + copiar verbatim a bundle en un helper, con test de dupe (compara comportamiento).

**R5: `plannerAttachments` como array embedded crece el doc**  
10 archivos * ~200 bytes de metadata = ~2KB. Aceptable (límite Firestore 1MB per doc). Si crece: mover a subcolección `pedidos/{id}/attachments/`.

**R6: Fases 2 y 3 pueden dejar cards huérfanas**  
Si Mariano manualmente puso `plannerStage='confirmado'` en fase 1, y en fase 2 el sync automático detecta un SO, `plannerStage` gana. Documentar: "override manual siempre gana; para volver a auto, setear `plannerStage=null` desde el modal".

### 11.2 · Decisiones abiertas

**D1: ¿Bulk actions?**  
No en MVP. Fase futura si Mariano lo pide.

**D2: ¿Filtros/búsqueda en el Kanban?**  
No en MVP. Cards ordenadas por `updatedAt desc`. Si hay >100 pedidos activos, agregar filtro por cliente/VDI en fase futura.

**D3: ¿Notificaciones push (además de email)?**  
No en MVP. Firebase Cloud Messaging queda para fase futura.

**D4: ¿Analytics de tiempo por columna?**  
Los datos están en `plannerHistory`. UI de reporte no está en MVP.

---

## 12. Referencias

- **Precedente Panel de Control Mariano-only**: `project_panel_control.md` (memoria), v611-v614.
- **Precedente MERCADOLIBRE section**: `docs/specs/2026-09-18-mercadolibre-crm-section-design.md`.
- **Regla emails via nodemailer**: `functions/core/notify-quotation-sent-core.js` (v774).
- **Regla core/wrapper CF**: CLAUDE.md §7.
- **Regla listeners cleanup**: CLAUDE.md §12.
- **Regla rules hasOnly whitelist**: `feedback_rules_whitelist_ui_drift.md` (memoria).
- **Regla dev branch + PR squash**: `feedback_app_vendedores_dev_branch.md` (memoria).
- **Dark mode WCAG AA**: `project_dark_mode_plan.md` (memoria), README §36.
- **Apple design**: skill `apple-design`.

---

**Estado**: Draft listo para review de Mariano. Próximo paso: `writing-plans` skill para generar el plan de implementación etapa por etapa (E0-E9).
