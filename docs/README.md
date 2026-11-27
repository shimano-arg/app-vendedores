# Documentación

La documentación almacenada en el repositorio debe explicar decisiones y uso
del código sin revelar información operativa sensible. Los runbooks, planes de
incidentes, inventarios de cuentas, datos de clientes, configuraciones de
entornos y procedimientos de despliegue se mantienen en sistemas internos de
acceso restringido.

Antes de agregar o modificar un archivo Markdown, ejecutá:

    node scripts/verify-docs-safety.mjs

No incluyas secretos, direcciones internas, contactos personales, rutas locales
ni instrucciones para administrar credenciales.
