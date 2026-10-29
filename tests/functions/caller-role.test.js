// @ts-check
/**
 * §SEC-AUTH-001 ítem 2 (PR #1 v1507) — unit tests de assertCallerRole.
 *
 * Helper puro usado por los wrappers de commitPedidoCF + updatePedidoLinesCF
 * para rechazar callers sin role o con role fuera del enum.
 */
import { describe, expect, it } from 'vitest';
import { ALLOWED_ROLES, assertCallerRole } from '../../functions/core/caller-role.js';

describe('assertCallerRole', () => {
  it('T1: role="vendedor" → ok, normalized="vendedor"', () => {
    const r = assertCallerRole('vendedor');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('vendedor');
    expect(r.errorCode).toBeUndefined();
  });

  it('T2: role="VENDEDOR" → ok (normaliza a lowercase)', () => {
    const r = assertCallerRole('VENDEDOR');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('vendedor');
  });

  it('T3: role="  interno  " → ok (trim)', () => {
    const r = assertCallerRole('  interno  ');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('interno');
  });

  it('T4: role="" → fail ROLE_REQUIRED', () => {
    const r = assertCallerRole('');
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('ROLE_REQUIRED');
    expect(r.normalized).toBe('');
  });

  it('T5: role="viewer" (fuera del enum) → fail ROLE_REQUIRED', () => {
    const r = assertCallerRole('viewer');
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('ROLE_REQUIRED');
    expect(r.normalized).toBe('viewer');
  });

  it('T6: role=null/undefined → fail ROLE_REQUIRED', () => {
    const r1 = assertCallerRole(null);
    expect(r1.ok).toBe(false);
    expect(r1.errorCode).toBe('ROLE_REQUIRED');
    const r2 = assertCallerRole(undefined);
    expect(r2.ok).toBe(false);
    expect(r2.errorCode).toBe('ROLE_REQUIRED');
  });

  it('T7 (export sanity): ALLOWED_ROLES contiene los 4 enum', () => {
    expect(ALLOWED_ROLES.has('vendedor')).toBe(true);
    expect(ALLOWED_ROLES.has('interno')).toBe(true);
    expect(ALLOWED_ROLES.has('gerente')).toBe(true);
    expect(ALLOWED_ROLES.has('admin')).toBe(true);
    expect(ALLOWED_ROLES.has('viewer')).toBe(false);
    expect(ALLOWED_ROLES.size).toBe(4);
  });
});
