// @ts-check
/**
 * hotfix 2026-10-29 — el servidor busca el usuario del vendedor del cliente
 * en los 4 roles (vendedor, interno, gerente, admin), igual que la pantalla
 * (§46). Antes solo miraba role='vendedor' → un cliente asignado a un VDI
 * (rol interno, ej. IOANNIS PALKOUDAKIS) o a un gerente daba
 * VENDOR_UID_MISSING cuando lo confirmaba un vendedor.
 */
import { describe, expect, it } from 'vitest';
import { resolveClientVendorServerSide } from '../../functions/core/resolve-client-vendor-core.js';

function makeMockDb({ roles, altas }) {
  return {
    collection(name) {
      return {
        where(_field, _op, value) {
          return {
            async get() {
              const docs =
                name === 'roles'
                  ? (roles || []).filter((r) => r.role === value)
                  : name === 'client_applications'
                    ? (altas || []).filter((a) => a.status === value)
                    : [];
              return {
                forEach(cb) {
                  for (const d of docs) cb({ id: d.uid, data: () => d });
                },
                size: docs.length,
              };
            },
          };
        },
      };
    },
  };
}

const ALTA_IOANNIS = {
  status: 'approved',
  cardCodeSap: 'C20293164852',
  comercio: 'JUAN MIGUEL BENGOCHEA',
  assignedVendor: 'IOANNIS PALKOUDAKIS',
};

describe('resolveClientVendorServerSide — roles', () => {
  it('cliente de un VDI (rol interno) resuelve su UID', async () => {
    const db = makeMockDb({
      roles: [
        { uid: 'uid-ioannis', role: 'interno', vendor: 'IOANNIS PALKOUDAKIS', email: 'i@x' },
        { uid: 'uid-mauricio', role: 'vendedor', vendor: 'MAURICIO GIL', email: 'm@x' },
      ],
      altas: [ALTA_IOANNIS],
    });
    const r = await resolveClientVendorServerSide({
      fbDb: db,
      cardCode: 'C20293164852',
      clientName: 'JUAN MIGUEL BENGOCHEA',
      vendorKeyHint: 'IOANNIS PALKOUDAKIS',
    });
    expect(r.vendorUid).toBe('uid-ioannis');
    expect(r.resolved).toBe(true);
  });

  it('cliente de un gerente resuelve por el hint aunque no esté en altas', async () => {
    const db = makeMockDb({
      roles: [{ uid: 'uid-santi', role: 'gerente', vendor: 'SANTIAGO ESTEBAN', email: 's@x' }],
      altas: [],
    });
    const r = await resolveClientVendorServerSide({
      fbDb: db,
      cardCode: 'C1',
      clientName: 'X',
      vendorKeyHint: 'SANTIAGO ESTEBAN',
    });
    expect(r.vendorUid).toBe('uid-santi');
  });

  it('si el mismo vendor está en varios roles gana el de rol vendedor', async () => {
    const db = makeMockDb({
      roles: [
        { uid: 'uid-admin', role: 'admin', vendor: 'PACHI', email: 'a@x' },
        { uid: 'uid-pachi', role: 'vendedor', vendor: 'PACHI', email: 'p@x' },
      ],
      altas: [],
    });
    const r = await resolveClientVendorServerSide({
      fbDb: db,
      cardCode: 'C2',
      clientName: 'Y',
      vendorKeyHint: 'PACHI',
    });
    expect(r.vendorUid).toBe('uid-pachi');
  });
});
