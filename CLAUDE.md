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
