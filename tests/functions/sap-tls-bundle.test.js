// @ts-check
/**
 * Test del CA bundle local que sumamos al trust store de Node via
 * NODE_EXTRA_CA_CERTS (declarado en functions/.env.app-vendedores-shimano).
 *
 * Scope:
 *   - El archivo existe en functions/certs/godaddy_bundle.pem.
 *   - Es un bundle PEM parseable con 3 certs.
 *   - El intermediate presente (que firma el cert hoja *.seidor.com.ar) es
 *     "GoDaddy TLS Intermediate CA DV - R1v1".
 *   - La env var del .env de firebase apunta al path correcto del container.
 *
 * NO toca red. NO toca servicios externos. Pura validacion del archivo + env.
 *
 * Razon (CLAUDE.md §29.1 pattern durable): el bundle es la fuente unica que
 * permite que las 17 CFs SAP cierren la cadena TLS contra el server Tomcat
 * de Seidor tras el upgrade SSL del 2026-11-17. Si el bundle se corrompe o
 * la env var se desalinea, estas pruebas lo pillan antes de deployar.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const BUNDLE_PATH = resolve(REPO_ROOT, 'functions', 'certs', 'godaddy_bundle.pem');
// .env.example es la fuente de verdad versionada. El .env.<project> concreto
// (ej. .env.app-vendedores-shimano) esta gitignored y solo existe en el
// filesystem del dev/CI que preparo el deploy; no se commitea.
const ENV_EXAMPLE_FILE = resolve(REPO_ROOT, 'functions', '.env.example');
const ENV_PROJECT_FILE = resolve(REPO_ROOT, 'functions', '.env.app-vendedores-shimano');

const EXPECTED_INTERMEDIATE_CN = 'GoDaddy TLS Intermediate CA DV - R1v1';
const EXPECTED_ROOT_CROSSSIGN_CN = 'GoDaddy TLS Root CA - R1';
const EXPECTED_ROOT_G2_CN = 'Go Daddy Root Certificate Authority - G2';

// Expected runtime path on Cloud Run container: /workspace/certs/godaddy_bundle.pem.
const EXPECTED_RUNTIME_PATH = '/workspace/certs/godaddy_bundle.pem';

function parsePemBundle(pemText) {
  const BEGIN = '-----BEGIN CERTIFICATE-----';
  const END = '-----END CERTIFICATE-----';
  const certs = [];
  let i = 0;
  while (true) {
    const start = pemText.indexOf(BEGIN, i);
    if (start === -1) break;
    const end = pemText.indexOf(END, start);
    if (end === -1) break;
    certs.push(pemText.slice(start, end + END.length));
    i = end + END.length;
  }
  return certs;
}

describe('SAP TLS bundle — contenido y shape', () => {
  it('functions/certs/godaddy_bundle.pem existe', () => {
    expect(existsSync(BUNDLE_PATH)).toBe(true);
  });

  it('es un bundle PEM parseable con 3 certs', () => {
    const text = readFileSync(BUNDLE_PATH, 'utf8');
    const certs = parsePemBundle(text);
    expect(certs.length).toBe(3);
  });

  it('incluye el intermediate GoDaddy TLS Intermediate CA DV - R1v1', () => {
    const text = readFileSync(BUNDLE_PATH, 'utf8');
    const certs = parsePemBundle(text);
    const subjects = certs.map((pem) => new X509Certificate(pem).subject);
    const hasIntermediate = subjects.some((s) => s.includes(EXPECTED_INTERMEDIATE_CN));
    expect(hasIntermediate, `subjects presentes: ${subjects.join(' | ')}`).toBe(true);
  });

  it('incluye el root R1 (cross-sign firmado por G2)', () => {
    const text = readFileSync(BUNDLE_PATH, 'utf8');
    const certs = parsePemBundle(text);
    const subjects = certs.map((pem) => new X509Certificate(pem).subject);
    const hasR1 = subjects.some((s) => s.includes(EXPECTED_ROOT_CROSSSIGN_CN));
    expect(hasR1, `subjects presentes: ${subjects.join(' | ')}`).toBe(true);
  });

  it('incluye el root G2 (Go Daddy Root Certificate Authority - G2)', () => {
    const text = readFileSync(BUNDLE_PATH, 'utf8');
    const certs = parsePemBundle(text);
    const subjects = certs.map((pem) => new X509Certificate(pem).subject);
    const hasG2 = subjects.some((s) => s.includes(EXPECTED_ROOT_G2_CN));
    expect(hasG2, `subjects presentes: ${subjects.join(' | ')}`).toBe(true);
  });

  it('cada cert esta vigente hoy (no expirado)', () => {
    const text = readFileSync(BUNDLE_PATH, 'utf8');
    const certs = parsePemBundle(text);
    const now = new Date();
    for (const pem of certs) {
      const x = new X509Certificate(pem);
      const notAfter = new Date(x.validToDate ?? x.validTo);
      expect(notAfter > now, `cert vencido: ${x.subject} (vence ${x.validTo})`).toBe(true);
    }
  });

  // Finding IMPORTANTE #2 del adversarial reviewer 2026-11-19: alerta temprana
  // de 30 dias para que el proximo vencimiento del bundle no sorprenda a CI/prod.
  // Si falla, renovar con Seidor + rotar el archivo functions/certs/godaddy_bundle.pem
  // antes del vencimiento.
  it('ningun cert vence en los proximos 30 dias (ventana de aviso)', () => {
    const text = readFileSync(BUNDLE_PATH, 'utf8');
    const certs = parsePemBundle(text);
    const umbral = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    for (const pem of certs) {
      const x = new X509Certificate(pem);
      const notAfter = new Date(x.validToDate ?? x.validTo);
      expect(
        notAfter > umbral,
        `cert vence en menos de 30 dias: ${x.subject} (vence ${x.validTo}). ` +
          'Coordinar renovacion con Seidor y rotar functions/certs/godaddy_bundle.pem.',
      ).toBe(true);
    }
  });

  it('la cadena esta ordenada: hoja -> R1v1 -> R1 -> G2 (issuers encadenados)', () => {
    const text = readFileSync(BUNDLE_PATH, 'utf8');
    const certs = parsePemBundle(text).map((pem) => new X509Certificate(pem));
    // Cert #0 (R1v1): issuer R1.
    expect(certs[0].subject).toContain(EXPECTED_INTERMEDIATE_CN);
    expect(certs[0].issuer).toContain(EXPECTED_ROOT_CROSSSIGN_CN);
    // Cert #1 (R1): issuer G2.
    expect(certs[1].subject).toContain(EXPECTED_ROOT_CROSSSIGN_CN);
    expect(certs[1].issuer).toContain(EXPECTED_ROOT_G2_CN);
    // Cert #2 (G2): autofirmado (subject == issuer).
    expect(certs[2].subject).toContain(EXPECTED_ROOT_G2_CN);
    expect(certs[2].issuer).toContain(EXPECTED_ROOT_G2_CN);
  });
});

describe('SAP TLS bundle — alineacion con .env.example (versioned)', () => {
  it('functions/.env.example existe y es fuente de verdad versionada', () => {
    expect(existsSync(ENV_EXAMPLE_FILE)).toBe(true);
  });

  it('declara NODE_EXTRA_CA_CERTS apuntando al path esperado en runtime', () => {
    const envText = readFileSync(ENV_EXAMPLE_FILE, 'utf8');
    const line = envText.split('\n').find((l) => l.trim().startsWith('NODE_EXTRA_CA_CERTS='));
    expect(line, 'falta NODE_EXTRA_CA_CERTS=... en .env.example').toBeDefined();
    const value = line.split('=', 2)[1].trim();
    expect(value).toBe(EXPECTED_RUNTIME_PATH);
  });

  it('el path local y el path esperado en runtime terminan en el mismo relpath', () => {
    const envText = readFileSync(ENV_EXAMPLE_FILE, 'utf8');
    const line = envText.split('\n').find((l) => l.trim().startsWith('NODE_EXTRA_CA_CERTS='));
    const value = line.split('=', 2)[1].trim();
    // Firebase Gen 2 copia functions/ a /workspace/ en el container.
    // functions/certs/godaddy_bundle.pem -> /workspace/certs/godaddy_bundle.pem.
    expect(value.endsWith('/certs/godaddy_bundle.pem')).toBe(true);
    expect(BUNDLE_PATH.replace(/\\/g, '/').endsWith('/certs/godaddy_bundle.pem')).toBe(true);
  });

  // Si alguien creo el .env.<project> concreto para un deploy local, chequear
  // que este alineado con el .env.example. No falla si el archivo no existe
  // (es gitignored por diseno; no todo clone lo tiene).
  it('si .env.app-vendedores-shimano existe, su NODE_EXTRA_CA_CERTS coincide con .env.example', () => {
    if (!existsSync(ENV_PROJECT_FILE)) {
      return; // skip — no hay archivo local; es escenario clone fresh y es OK.
    }
    const projectText = readFileSync(ENV_PROJECT_FILE, 'utf8');
    const projectLine = projectText
      .split('\n')
      .find((l) => l.trim().startsWith('NODE_EXTRA_CA_CERTS='));
    expect(projectLine, 'el .env.<project> local existe pero no declara NODE_EXTRA_CA_CERTS').toBeDefined();
    const projectValue = projectLine.split('=', 2)[1].trim();
    expect(projectValue).toBe(EXPECTED_RUNTIME_PATH);
  });
});
