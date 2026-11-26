// S04 B2-b — tests unitarios de getTotpStatusCore.
// Verifica que el core:
//   1. Devuelve {enabled, hasSecret, setAt} para un usuario con TOTP activo.
//   2. Devuelve enabled=false, hasSecret=false para un usuario sin TOTP.
//   3. Devuelve enabled=false, hasSecret=false cuando el doc no existe.
//   4. NUNCA incluye totpSecret ni passwordHash en la respuesta.
//   5. Respeta la separacion de roles (admin/gerente vs otros) — testeado en
//      el wrapper CF (functions/index.js:getTotpStatusCF), no en el core puro.
import { describe, expect, it } from 'vitest';
import { getTotpStatusCore } from '../../functions/core/auth-secrets-core.js';

// ---- Helpers de mock Firestore ----

/**
 * Fabrica un mock de deps.fbDb que devuelve un doc con los datos indicados.
 * @param {object|null} docData - null = doc no existe
 */
function makeMockDb(docData) {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: docData !== null,
          data: () => (docData !== null ? { ...docData } : undefined),
        }),
      }),
    }),
  };
}

const baseDeps = { log: () => {} };

// ---- Tests ----

describe('getTotpStatusCore', () => {
  it('T1 — usuario con TOTP activo: devuelve enabled=true, hasSecret=true, setAt correcto', async () => {
    const db = makeMockDb({
      totpEnabled: true,
      totpSecret: 'BASE32SECRETVALIDO',
      totpSetAt: '2026-11-01T10:00:00.000Z',
    });
    const result = await getTotpStatusCore({ ...baseDeps, fbDb: db }, 'uid-test-01');
    expect(result.enabled).toBe(true);
    expect(result.hasSecret).toBe(true);
    expect(result.setAt).toBe('2026-11-01T10:00:00.000Z');
  });

  it('T2 — usuario sin TOTP (totpEnabled=false, sin totpSecret): devuelve todo false', async () => {
    const db = makeMockDb({
      totpEnabled: false,
      passwordHash: 'hashseguro',
    });
    const result = await getTotpStatusCore({ ...baseDeps, fbDb: db }, 'uid-test-02');
    expect(result.enabled).toBe(false);
    expect(result.hasSecret).toBe(false);
    expect(result.setAt).toBeNull();
  });

  it('T3 — doc auth_secrets no existe: devuelve {enabled:false, hasSecret:false, setAt:null}', async () => {
    const db = makeMockDb(null);
    const result = await getTotpStatusCore({ ...baseDeps, fbDb: db }, 'uid-no-doc');
    expect(result).toEqual({ enabled: false, hasSecret: false, setAt: null });
  });

  it('T4 — la respuesta NUNCA incluye totpSecret ni passwordHash', async () => {
    const db = makeMockDb({
      totpEnabled: true,
      totpSecret: 'SECRETOMUYSECRETO',
      passwordHash: 'hashseguro',
      passwordSalt: 'saltseguro',
      totpSetAt: '2026-11-01T10:00:00.000Z',
    });
    const result = await getTotpStatusCore({ ...baseDeps, fbDb: db }, 'uid-test-04');
    // La respuesta no debe incluir secretos ni hashes
    expect(result).not.toHaveProperty('totpSecret');
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('passwordSalt');
    // Solo los 3 campos documentados
    expect(Object.keys(result).sort()).toEqual(['enabled', 'hasSecret', 'setAt'].sort());
  });

  it('T5 — targetUid vacio lanza error', async () => {
    const db = makeMockDb(null);
    await expect(getTotpStatusCore({ ...baseDeps, fbDb: db }, '')).rejects.toThrow(
      'targetUid requerido'
    );
    await expect(getTotpStatusCore({ ...baseDeps, fbDb: db }, null)).rejects.toThrow(
      'targetUid requerido'
    );
  });
});
