# Brief de reunión — Integración app-vendedores ↔ SETUP (WMS)

**Fecha reunión:** Martes 2026-09-02
**Participantes por Shimano:** Mariano Erbino (Data Scientist / Product Owner app-vendedores)
**Participantes por SETUP:** (a completar)
**Objetivo:** Definir la integración técnica para que **Shimano vea en tiempo real el estado logístico** (picking, armado, despachado, entregado) de cada pedido desde su app interna.

---

## 1. Contexto de negocio

Shimano Argentina opera un app propia (`shimano-arg.github.io/app-vendedores`) donde ~10 usuarios internos (vendedores externos, VDIs, gerencia) cargan pedidos que se transfieren a SAP B1 vía Service Layer. Esos pedidos son procesados en el depósito operado por el partner logístico usando **SETUP** como WMS.

**Hoy:** los vendedores no tienen visibilidad del estado logístico. Deben pedir por WhatsApp/mail a admin o al partner para saber si un pedido ya salió, dónde está la guía, etc.

**Objetivo:** que cada pedido en la app-vendedores muestre un timeline de estados (Confirmado SAP → Picking → Armado → Despachado → Entregado) actualizado desde SETUP, sin intervención manual.

## 2. Flujo actual y flujo objetivo

**Actual:**

```
Vendedor → app-vendedores → SAP B1 (Service Layer) → SETUP (interface B1 → auto)
                                                       ↓
                                                     (opaco para Shimano)
```

**Objetivo:**

```
Vendedor → app-vendedores → SAP B1 → SETUP (sin cambios)
              ↑                          ↓
              └─── Cloud Function ←── API REST ──── SETUP (nuevo)
                    (polling cada 10 min)
```

**Nota:** la integración es **solo LECTURA** (Shimano consume, no escribe). SETUP no tiene que modificar cómo recibe pedidos hoy.

## 3. Arquitectura propuesta

**Opción A — REST API polling (default recomendado):**
- Cloud Function `syncSetupStatus` en Google Cloud Platform (project `app-vendedores-shimano`, región `southamerica-east1`)
- Trigger: Cloud Scheduler cada 10 minutos
- Lee `since_last_sync` desde Firestore, llama `GET /orders?since={timestamp}` al API de SETUP
- Upsert en Firestore collection `logistics_status/{sapDocNum}`
- Ventaja: no requiere que SETUP desarrolle nada nuevo, solo exponer API que ya tienen
- Latencia: 5-15 min (aceptable para el use case operativo)

**Opción B — Webhooks (futuro / v2):**
- SETUP hace HTTP POST a nuestra Cloud Function `setupWebhook` cuando cambia estado
- Latencia real-time (<30 seg)
- Requiere que SETUP soporte webhooks nativamente
- Plantear como fase 2 si la latencia de 10 min molesta operativamente

---

## 4. Checklist técnico para la reunión (completar en vivo)

### 4.1 Acceso al API

| Pregunta | Respuesta SETUP | Notas |
|---|---|---|
| URL base del API productivo | | |
| URL base del API sandbox / test | | |
| Formato (asumo JSON REST) | | |
| Método de autenticación (API key / OAuth / IP whitelist) | | |
| ¿Nos dan credenciales sandbox antes de tocar prod? | | |
| Rate limits (requests/min) | | |
| Paginación (offset / cursor / max resultados por request) | | |
| ¿Tienen doc pública? URL | | |
| ¿A quién contactamos para dudas técnicas? (nombre + email) | | |

### 4.2 Endpoints necesarios (mínimo viable)

Confirmar que SETUP expone al menos estos 2:

- [ ] **`GET /orders?since={ISO8601}`** — pedidos modificados desde X (para polling incremental)
- [ ] **`GET /orders/{sapDocNum}`** — detalle de un pedido específico por ID

Nice-to-have (v2):
- [ ] `GET /orders/{sapDocNum}/timeline` — historial completo de cambios de estado
- [ ] Webhook signup endpoint para v2

### 4.3 Data model — la más importante

| Pregunta | Respuesta SETUP | Notas |
|---|---|---|
| ¿Cómo identifican nuestro pedido? (SAP DocNum / ID propio SETUP) | | |
| Si usan ID propio: ¿cómo mapeamos SAP DocNum ↔ SETUP ID? | | |
| ¿El SAP DocNum es campo indexado/searchable en su lado? | | |
| ¿Un pedido puede tener múltiples estados simultáneos? (ej. por línea) | | |
| Metadata extra: guía transportista? | | |
| Metadata extra: nombre transportista? | | |
| Metadata extra: fecha estimada de entrega? | | |
| Metadata extra: foto de remito firmado (POD)? | | |
| Metadata extra: tracking URL público del transportista? | | |

### 4.4 Lista completa de estados

**Pedirles que completen esta tabla ahí (o por email post-reunión):**

| Código SETUP | Nombre operativo | Significado | ¿Es terminal? |
|---|---|---|---|
| `___` | ___ | ___ | Sí / No |
| `___` | ___ | ___ | Sí / No |
| `___` | ___ | ___ | Sí / No |
| `___` | ___ | ___ | Sí / No |
| `___` | ___ | ___ | Sí / No |
| `___` | ___ | ___ | Sí / No |

Ejemplos posibles a esperar: `pending`, `picking`, `packed`, `shipped`, `delivered`, `partial`, `returned`, `cancelled`.

---

## 5. Checklist de negocio

| Pregunta | Respuesta SETUP | Notas |
|---|---|---|
| ¿Costo de la integración? (gratis / por transacción / setup fee) | | |
| Timeline: ¿cuándo pueden dar credenciales sandbox? | | |
| Timeline: ¿cuándo prod-ready? | | |
| ¿Nos dan backfill de pedidos históricos? (últimos N meses) | | |
| ¿Hay SLA de uptime del API? | | |
| ¿Ventanas de mantenimiento programadas? | | |
| ¿Cuál es el proceso si el API se cae en horario laboral? | | |
| ¿Tienen webhooks nativos? (para v2) | | |

---

## 6. Estimación de trabajo por parte de Shimano (post go-live sandbox)

Asumiendo Opción A (polling REST):

| Fase | Trabajo | Tiempo |
|---|---|---|
| **Setup** | Guardar `SETUP_API_KEY` en Google Secret Manager, IAM del service account | 1 día |
| **Cloud Function** | `syncSetupStatus` + tests unitarios con mocks + logging estructurado | 2-3 días |
| **Firestore** | Nueva collection `logistics_status`, rules, índices | 0.5 día |
| **UI app** | Sección "Timeline logístico" en el detalle del pedido + badge en la lista | 2 días |
| **Deploy prod** | `firebase deploy --only functions:syncSetupStatus`, monitoring, alertas | 0.5 día |
| **QA end-to-end** | Con credenciales sandbox, cruzar con casos reales, validar mapping | 2-3 días |
| **Total estimado** | | **8-10 días de dev** |

---

## 7. Riesgos anticipados a mencionar en la reunión

- **Mapping SAP DocNum:** si SETUP no guarda el DocNum SAP como campo searchable, la integración se rompe. Confirmar que sí lo tienen.
- **Vendor lock-in:** si Shimano cambia de operador logístico en el futuro, la integración se tira. Diseñaremos con un `SetupAdapter` interface para poder reemplazar solo la capa cliente.
- **Estado desincronizado:** si SETUP cae 4 horas, la app-vendedores muestra estado stale. Vamos a mostrar un badge "Última sync hace X min" para que los users sepan.
- **Backfill histórico:** si no nos dan pedidos ya despachados, perdemos analytics históricos. Pedir al menos 3-6 meses de backfill.

---

## 8. Salida esperada de la reunión

Al cerrar la reunión, deberíamos tener:

1. ✅ Confirmación de que SETUP nos dará acceso al API
2. ✅ Compromiso de fecha para credenciales sandbox
3. ✅ Doc del API (URL / archivo)
4. ✅ Contacto técnico de SETUP (email + rol)
5. ✅ Lista completa de estados con sus códigos
6. ✅ Confirmación de que SAP DocNum es searchable en su lado
7. ✅ Definición de costo (o "sin costo")
8. ✅ Próxima reunión de kickoff técnico agendada (una vez con doc + sandbox en mano)

---

## 9. Anexos

**Referencia técnica app-vendedores:**
- Repo: https://github.com/shimano-arg/app-vendedores
- Stack: HTML5 + Firebase (Firestore + Auth + Functions) + Cloud Scheduler
- Región GCP: `southamerica-east1`
- Ya tenemos experiencia integrando con SAP B1 Service Layer (Cloud Function `sapProxy` v690)
- Ya tenemos experiencia consumiendo APIs externas con secrets en Google Secret Manager (Gemini OCR, SAP)

**Contactos de Shimano:**
- **Mariano Erbino** (Product Owner / Data Scientist) — `erbinomariano@gmail.com` / `mariano.erbino@shimano.com.ar`
- (Otros a completar según asista)

**Formato de datos preferido para respuestas post-reunión:**
- Doc del API en PDF o URL
- Lista de estados en Excel o CSV
- Credenciales sandbox por canal seguro (no email plano — pedir mensaje encriptado o portal)
