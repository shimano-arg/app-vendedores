#!/usr/bin/env node
/**
 * Smoke test local — valida que el bundle GoDaddy permite handshake TLS
 * exitoso contra el server real SAP Service Layer de Seidor.
 *
 * Uso:
 *   NODE_EXTRA_CA_CERTS=functions/certs/godaddy_bundle.pem \
 *     node scripts/audit/BA_sap_tls_smoke.cjs
 *
 * NO toca produccion de datos. NO autentica contra SL. Solo hace un GET
 * sobre la raiz del Service Layer y confirma que:
 *   - El handshake TLS cierra (sin SELF_SIGNED_CERT_IN_CHAIN).
 *   - El server responde con un HTTP valido (cualquiera — 404, 401, 200...).
 *   - El hostname del cert matchea *.seidor.com.ar.
 *
 * NO forma parte del CI. Es diagnostico manual.
 *
 * Mariano: este script SOLO lee (GET). Si fallara autenticacion, no pasa
 * nada — queremos ver el handshake, no el payload. Ejecutalo despues del
 * deploy para confirmar que las CFs van a poder hablar con SAP.
 */

'use strict';

const HOSTNAME = 'shimano-sap.seidor.com.ar';
const URL = `https://${HOSTNAME}/b1s/v1/`;

(async () => {
  const caPath = process.env.NODE_EXTRA_CA_CERTS;
  console.log('--- SAP TLS smoke test ---');
  console.log(`Node:          ${process.version}`);
  console.log(`NODE_EXTRA_CA_CERTS: ${caPath || '<not set>'}`);
  console.log(`Target:        ${URL}`);
  console.log('');

  const started = Date.now();
  try {
    const resp = await fetch(URL, {
      method: 'GET',
      signal: AbortSignal.timeout(30_000),
    });
    const elapsed = Date.now() - started;
    console.log(`OK handshake TLS + HTTP (${elapsed} ms)`);
    console.log(`Status: ${resp.status} ${resp.statusText}`);
    const text = await resp.text();
    console.log(`Body (primeros 200 chars):`);
    console.log(text.slice(0, 200));
    console.log('');
    console.log('[PASS] handshake cerro sin SELF_SIGNED_CERT_IN_CHAIN.');
    console.log('[PASS] server respondio HTTP valido.');
    process.exit(0);
  } catch (e) {
    const elapsed = Date.now() - started;
    const msg = e && e.message ? e.message : String(e);
    const code = e && e.code ? e.code : '(sin code)';
    const cause = e && e.cause ? e.cause : null;
    const causeCode = cause && cause.code ? cause.code : '(sin cause.code)';
    const causeMsg = cause && cause.message ? cause.message : '(sin cause.message)';
    console.log(`FAIL (${elapsed} ms)`);
    console.log(`error.message: ${msg}`);
    console.log(`error.code:    ${code}`);
    console.log(`cause.code:    ${causeCode}`);
    console.log(`cause.message: ${causeMsg}`);
    console.log('');
    if (causeCode === 'SELF_SIGNED_CERT_IN_CHAIN' || causeCode === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY') {
      console.log('[FAIL] cadena TLS NO cerro. Revisar NODE_EXTRA_CA_CERTS y el bundle.');
    } else if (causeCode === 'ENOTFOUND' || causeCode === 'ECONNREFUSED') {
      console.log('[FAIL] conectividad de red al server SAP — NO es problema de certs.');
    } else {
      console.log('[FAIL] otro error. Inspeccionar cause.');
    }
    process.exit(1);
  }
})();
