// @ts-check
/**
 * E3 §auditgrises G1.G15 — sendingSapLock TTL subido a 15 min:
 * precedente 2026-08-21 Mariano reportó SQs duplicadas por lock stale.
 * El default anterior 5 min (300000) + SAP SL >5min bajo carga = re-trigger
 * pisaba y creaba duplicate SQ aunque hubiera idempotence check post-fail.
 * Nuevo default 15 min (900000) cubre p99 observado de POST SL.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const AUTO_SEND = readFileSync('functions/core/auto-send-sap-core.js', 'utf8');

describe('G1.G15 — sendingSapLock TTL default 15 min', () => {
  it('lockTtlMs default es 900000 (15 min), no 300000 (5 min)', () => {
    expect(AUTO_SEND).toMatch(/lockTtlMs\s*=\s*deps\.lockTtlMs\s*\?\?\s*900000/);
    expect(AUTO_SEND).not.toMatch(/lockTtlMs\s*=\s*deps\.lockTtlMs\s*\?\?\s*300000/);
  });

  it('código referencia precedente 2026-08-21 + rationale', () => {
    expect(AUTO_SEND).toMatch(/G1\.G15/);
    expect(AUTO_SEND).toMatch(/2026-08-21/);
  });

  it('existe guard existingLock pre-POST', () => {
    expect(AUTO_SEND).toMatch(/existingLock\.at.*now\s*-\s*existingLock\.at\s*<\s*lockTtlMs/);
  });
});
