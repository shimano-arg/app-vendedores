// @ts-nocheck
/** SEC-02 pre-deploy: clasificación del script AT (solo lectura). Datos ficticios. */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  classify,
  redactEmail,
  redactUid,
} = require('../../../scripts/audit/AT_auth_vs_roles_readonly.cjs');

const u = (uid, extra = {}) => ({
  uid,
  email: uid + '@test.invalid',
  providers: ['google.com'],
  emailVerified: true,
  disabled: false,
  ...extra,
});

describe('AT classify', () => {
  it('marca sin doc, rol vacío, unassigned y viewer como bloqueables; vendedor (cualquier mayúscula) OK', () => {
    const roles = new Map([
      ['v', { exists: true, role: 'Vendedor' }],
      ['vacio', { exists: true, role: '' }],
      ['un', { exists: true, role: 'unassigned' }],
      ['vw', { exists: true, role: 'viewer' }],
    ]);
    const r = classify(
      [u('v'), u('vacio'), u('un'), u('vw'), u('sindoc')],
      roles,
      new Map([['vw', 3]])
    );
    expect(r.ok).toBe(1);
    expect(r.bloqueables.map((x) => x.estado).sort()).toEqual(
      [
        'ROL_NO_PERMITIDO(unassigned)',
        'ROL_NO_PERMITIDO(viewer)',
        'ROL_VACIO',
        'SIN_DOC_ROLES',
      ].sort()
    );
    expect(r.bloqueables[0].uid).toBe('vw'); // los que tienen pedidos recientes van primero
    expect(r.bloqueablesConPedidos).toHaveLength(1);
  });
  it('los deshabilitados no cuentan como bloqueables', () => {
    const r = classify([u('x', { disabled: true })], new Map(), new Map());
    expect(r.bloqueables).toHaveLength(0);
    expect(r.deshabilitados).toBe(1);
  });
  it('redacta email y uid', () => {
    expect(redactEmail('mariano@empresa.com')).toBe('m***@empresa.com');
    expect(redactUid('abcdefghijkl')).toBe('abcdef…');
  });
});
