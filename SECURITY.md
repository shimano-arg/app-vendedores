# Seguridad

## Reportar una exposición

No publiques vulnerabilidades, credenciales, datos personales ni detalles de
incidentes en issues, discusiones o pull requests. Informalos por el canal
interno restringido de seguridad para que el equipo pueda evaluar, contener y
rotar lo que corresponda.

## Reglas de contribución

- No versionar secretos, archivos de entorno, exportaciones de datos ni claves
  o certificados privados.
- Usar datos sintéticos y sin información personal para pruebas y ejemplos.
- No incluir contactos personales, rutas locales, identificadores de entornos
  ni comandos de administración de secretos en archivos Markdown.
- Antes de compartir un cambio, revisar el diff y ejecutar
  node scripts/verify-docs-safety.mjs

La automatización del repositorio ejecuta la misma verificación sobre cambios
de documentación.
