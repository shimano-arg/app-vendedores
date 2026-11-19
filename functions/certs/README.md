# functions/certs/

CA bundles que Node.js suma al trust store built-in via la env var
`NODE_EXTRA_CA_CERTS` (declarada en `functions/.env.app-vendedores-shimano`).

## godaddy_bundle.pem

Cadena GoDaddy DV R1v1 provista por Seidor (proveedor SAP Business One) tras
el upgrade SSL del servidor Tomcat `shimano-sap.seidor.com.ar` en 2026-11-17.

**Certs incluidos** (en este orden):
1. `GoDaddy TLS Intermediate CA DV - R1v1` — intermediate que firma el cert
   hoja `*.seidor.com.ar`.
2. `GoDaddy TLS Root CA - R1` — cross-sign intermediate firmado por G2.
3. `Go Daddy Root Certificate Authority - G2` — root autofirmado (ya está
   en el Mozilla CA bundle que Node trae built-in; el que el server NO envía
   durante el handshake).

**Por qué hace falta**: el server Tomcat de Seidor manda la cadena
`hoja -> Intermediate R1v1 -> Root R1` durante el handshake, pero NO envía G2.
Node intenta construir la cadena hasta un root reconocido y falla con
`SELF_SIGNED_CERT_IN_CHAIN` (mensaje engañoso de Node/OpenSSL que realmente
significa "unable to get local issuer certificate"). Agregar este bundle al
`NODE_EXTRA_CA_CERTS` le permite a Node cerrar la cadena localmente contra G2
(que ya conocía) o contra R1/R1v1 (que ahora conoce via este archivo).

**No reemplaza** el trust store built-in. Solo suma. Zero riesgo de romper
TLS a otros servicios (BigQuery, Gemini, SMTP, GitHub, etc.).

**Validación local**:

```bash
openssl verify -CAfile functions/certs/godaddy_bundle.pem \
  functions/certs/godaddy_bundle.pem

openssl s_client -connect shimano-sap.seidor.com.ar:443 \
  -servername shimano-sap.seidor.com.ar \
  -CAfile functions/certs/godaddy_bundle.pem < /dev/null | \
  grep "Verification"
# Esperado: "Verification: OK"
```

**Recomendación al proveedor Seidor** (Claudio): reconfigurar el
`server.xml` de Tomcat para que `SSLCertificateChainFile` incluya la cadena
completa (intermediate + root cross-sign) durante el handshake. Con eso
este bundle local deja de ser necesario (pero no molesta — sigue siendo
válido como defensa en profundidad).

**Rotación**: si Seidor renueva el cert hoja pero mantiene el mismo
intermediate GoDaddy DV R1v1, este bundle NO necesita actualizarse. Si
cambian de CA, reemplazar el archivo + validar con `openssl verify` antes
de deployar.
