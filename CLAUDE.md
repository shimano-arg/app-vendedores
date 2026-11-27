# Instrucciones de trabajo

Este archivo contiene reglas seguras y durables para colaborar en el
repositorio. No es un lugar para guardar estado operativo, incidentes, datos
de personas, identificadores de infraestructura ni instrucciones de acceso.

## Alcance

- Trabajá solo sobre el cambio solicitado y preservá modificaciones ajenas.
- Inspeccioná el estado de Git antes de editar; usá una rama o worktree aislado
  para cambios de alcance independiente.
- Preferí cambios pequeños, revisables y con pruebas proporcionales al riesgo.

## Seguridad y privacidad

- Nunca imprimas, copies ni agregues secretos, tokens, claves privadas,
  certificados privados, archivos de entorno o credenciales.
- No uses datos reales de clientes, pedidos o empleados en fixtures, pruebas,
  documentación, logs o commits.
- No documentes correos personales, rutas locales, nombres de cuentas,
  endpoints internos, identificadores de proyectos ni procedimientos de acceso.
- No ejecutes operaciones contra producción ni cambies permisos, secretos o
  despliegues sin una autorización explícita en la tarea actual.
- Si aparece material sensible ya versionado, detené su difusión, avisá por un
  canal restringido y seguí el procedimiento de rotación o revocación aplicable.

## Calidad

- Leé las instrucciones locales del paquete antes de modificarlo.
- Validá formato, tipos y pruebas relevantes sin ensanchar el cambio.
- No declares una corrección como verificada si la evidencia no la cubre.
- Mantené la documentación pública o compartida en un nivel conceptual; los
  runbooks operativos viven fuera del repositorio.

## 69. DEUDA técnica — reemplazar monkey-patch firestore-sanitize por función única de escritura

El reemplazo planificado vive en src/pure/safe-write.js y expone
safeWriteWaitlist y safeWritePedido. Hasta completar ese refactor, el baseline
máximo es de 19 call-sites directos. No agregues nuevos writes directos fuera
del helper sin una revisión técnica.

## 70. Errores de write client-side se loguean a operations_log

Los fallos de escritura se registran como type: 'client_write_failed' con los
campos mínimos userUid, collection y documentId. El registro debe ser
fire-and-forget: nunca debe bloquear el flujo de la interfaz ni almacenar
contenido de clientes, credenciales o detalles sensibles.
