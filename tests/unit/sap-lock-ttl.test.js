// v1005 (2026-09-22): valida que la constante compartida SAP_LOCK_TTL_MS
// coincida con el default del CF core (auto-send-sap-core.js line 392,
// `deps.lockTtlMs ?? 300000`). Sin este test, un dev puede subir SAP_LOCK_TTL_MS
// (client-side) sin actualizar el CF default -> los flows quedan desalineados
// otra vez (bug v1004 rearmed).
//
// Ademas: parsea los 2 modulos client-side (sap-auto-send-listener.js,
// sap-admin-panel.js) y asegura que las 2 comparaciones `lockAgeMs < X`
// referencien la constante importada, no un literal numerico.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SAP_LOCK_TTL_MS } from '../../src/domains/sap-lock-constants.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('SAP_LOCK_TTL_MS', () => {
  it('vale 300000 (5 min) — mismo valor que v577 subio el listener tras el incidente Ioannis+Jonatan', () => {
    expect(SAP_LOCK_TTL_MS).toBe(300000);
  });

  it('coincide con el default del CF core (functions/core/auto-send-sap-core.js lockTtlMs ?? X)', () => {
    const coreSrc = readFileSync(`${ROOT}/functions/core/auto-send-sap-core.js`, 'utf-8');
    // Match: `deps.lockTtlMs ?? 300000` (o similar). Extrae el numero literal.
    const match = coreSrc.match(/deps\.lockTtlMs\s*\?\?\s*(\d+)/);
    expect(match, 'no encontre `deps.lockTtlMs ?? <number>` en auto-send-sap-core.js').not.toBeNull();
    const cfDefault = Number(match[1]);
    expect(cfDefault).toBe(SAP_LOCK_TTL_MS);
  });

  it('sap-auto-send-listener.js usa SAP_LOCK_TTL_MS (no literal numerico)', () => {
    const src = readFileSync(`${ROOT}/src/domains/sap-auto-send-listener.js`, 'utf-8');
    // Debe importar la constante.
    expect(src).toContain("from './sap-lock-constants.js'");
    expect(src).toContain('SAP_LOCK_TTL_MS');
    // Y NO debe tener el patron viejo `lockAgeMs < 300000` ni `< 60000`.
    expect(src).not.toMatch(/lockAgeMs\s*<\s*\d+/);
  });

  it('sap-admin-panel.js usa SAP_LOCK_TTL_MS (no literal numerico)', () => {
    const src = readFileSync(`${ROOT}/src/domains/sap-admin-panel.js`, 'utf-8');
    expect(src).toContain("from './sap-lock-constants.js'");
    expect(src).toContain('SAP_LOCK_TTL_MS');
    expect(src).not.toMatch(/lockAgeMs\s*<\s*\d+/);
  });
});
