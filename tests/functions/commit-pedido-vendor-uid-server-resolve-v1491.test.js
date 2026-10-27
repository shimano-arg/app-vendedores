// @ts-check
/**
 * v1491 §89 HOTFIX (2026-10-27) — commitPedidoCF resuelve UID server-side
 * cuando el cliente no pudo (típicamente VDE con rules bloqueando `roles`).
 *
 * Reporte Mariano: 15 rechazos VENDOR_UID_MISSING el 27/10, todos de VDEs,
 * sobre clientes con vendorAssigned válido. Admin pasa porque su navegador
 * puede leer `roles` + arma mapa UID. VDE no.
 *
 * Fix: en el gate, si llegó vendorAssigned sin assignedVendorUid, intentar
 * server-side con admin SDK (lee roles + client_applications sin restricción
 * de rules). Si resuelve → setear en payload + continuar; si no → rechazar.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock Firestore admin con roles + client_applications.
function makeMockDb({ roles, altas }) {
  return {
    collection(name) {
      return {
        where(_field, _op, value) {
          return {
            async get() {
              const docs = (() => {
                if (name === 'roles') {
                  return (roles || []).filter((r) => r.role === value);
                }
                if (name === 'client_applications') {
                  return (altas || []).filter((a) => a.status === value);
                }
                return [];
              })();
              return {
                forEach(cb) {
                  for (const d of docs) {
                    cb({ id: d.uid || d._id || '', data: () => d });
                  }
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

describe('v1491 §89 — resolveClientVendorServerSide', () => {
  it('T1 resuelve UID por approvedAlta cuando client no lo cargó', async () => {
    const { resolveClientVendorServerSide } = await import(
      '../../functions/core/resolve-client-vendor-core.js'
    );
    const db = makeMockDb({
      roles: [
        { uid: 'uid-mauricio', role: 'vendedor', vendor: 'MAURICIO GIL', email: 'm@x' },
        { uid: 'uid-federico', role: 'vendedor', vendor: 'FEDERICO CASTELANELLI', email: 'f@x' },
      ],
      altas: [
        {
          _id: 'alta1',
          status: 'approved',
          cardCodeSap: 'C20330164787',
          comercio: 'BATTISTONI',
          assignedVendor: 'MAURICIO GIL',
        },
      ],
    });
    const r = await resolveClientVendorServerSide({
      fbDb: db,
      cardCode: 'C20330164787',
      clientName: 'BATTISTONI',
      vendorKeyHint: 'MAURICIO GIL',
    });
    expect(r.resolved).toBe(true);
    expect(r.vendorKey).toBe('MAURICIO GIL');
    expect(r.vendorUid).toBe('uid-mauricio');
    expect(r.reason).toBe('ok');
  });

  it('T2 fallback por vendorKeyHint cuando master no tiene cardCode', async () => {
    const { resolveClientVendorServerSide } = await import(
      '../../functions/core/resolve-client-vendor-core.js'
    );
    const db = makeMockDb({
      roles: [
        { uid: 'uid-federico', role: 'vendedor', vendor: 'FEDERICO CASTELANELLI', email: 'f@x' },
      ],
      altas: [], // no hay master
    });
    const r = await resolveClientVendorServerSide({
      fbDb: db,
      cardCode: 'C_NO_EXISTE',
      clientName: 'cliente desconocido',
      vendorKeyHint: 'FEDERICO CASTELANELLI',
    });
    expect(r.resolved).toBe(true);
    expect(r.vendorUid).toBe('uid-federico');
    expect(r.reason).toBe('ok');
  });

  it('T3 fallback con label histórico "Z5 - Mauricio" → MAURICIO GIL', async () => {
    const { resolveClientVendorServerSide } = await import(
      '../../functions/core/resolve-client-vendor-core.js'
    );
    const db = makeMockDb({
      roles: [{ uid: 'uid-mauricio', role: 'vendedor', vendor: 'MAURICIO GIL', email: 'm@x' }],
      altas: [],
    });
    const r = await resolveClientVendorServerSide({
      fbDb: db,
      cardCode: 'C123',
      clientName: 'ALGUIEN',
      vendorKeyHint: 'Z5 - Mauricio',
    });
    expect(r.vendorUid).toBe('uid-mauricio');
  });

  it('T4 fallback por primer nombre: hint "MAURICIO" matchea "MAURICIO GIL"', async () => {
    const { resolveClientVendorServerSide } = await import(
      '../../functions/core/resolve-client-vendor-core.js'
    );
    const db = makeMockDb({
      roles: [{ uid: 'uid-mauricio', role: 'vendedor', vendor: 'MAURICIO GIL', email: 'm@x' }],
      altas: [],
    });
    const r = await resolveClientVendorServerSide({
      fbDb: db,
      cardCode: 'C123',
      clientName: 'ALGUIEN',
      vendorKeyHint: 'MAURICIO',
    });
    expect(r.vendorUid).toBe('uid-mauricio');
  });

  it('T5 sin match posible: devuelve mejor resolución (vendor_sin_uid o cliente_no_en_master)', async () => {
    const { resolveClientVendorServerSide } = await import(
      '../../functions/core/resolve-client-vendor-core.js'
    );
    const db = makeMockDb({ roles: [], altas: [] });
    const r = await resolveClientVendorServerSide({
      fbDb: db,
      cardCode: 'C999',
      clientName: 'NADIE',
      vendorKeyHint: 'NO EXISTE',
    });
    expect(r.resolved).toBe(false);
    expect(r.vendorUid).toBe('');
  });

  it('T6 Firestore read falla → devuelve EMPTY sin crashear', async () => {
    const { resolveClientVendorServerSide } = await import(
      '../../functions/core/resolve-client-vendor-core.js'
    );
    const db = {
      collection() {
        return {
          where() {
            return {
              async get() {
                throw new Error('firestore down');
              },
            };
          },
        };
      },
    };
    // No tira: try/catch internos capturan.
    const r = await resolveClientVendorServerSide({
      fbDb: db,
      cardCode: 'C123',
      clientName: 'X',
      vendorKeyHint: 'MAURICIO GIL',
    });
    expect(r).toBeDefined();
    // Sin users ni altas, devuelve vendor_sin_uid o cliente_no_en_master.
    expect(r.vendorUid).toBe('');
  });

  it('T7 fbDb null → devuelve EMPTY', async () => {
    const { resolveClientVendorServerSide } = await import(
      '../../functions/core/resolve-client-vendor-core.js'
    );
    const r = await resolveClientVendorServerSide({ fbDb: null });
    expect(r.resolved).toBe(false);
  });
});

describe('v1491 §89 — commit-pedido-core gate llama resolver server-side', () => {
  it('T20 el import de resolveClientVendorServerSide está presente', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    expect(src).toMatch(
      /import \{\s*resolveClientVendorServerSide\s*\} from ['"]\.\/resolve-client-vendor-core\.js['"]/
    );
  });

  it('T21 el gate VENDOR_UID_MISSING ahora intenta resolver server-side antes de rechazar', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    // La llamada makeError('VENDOR_UID_MISSING', ...) debe venir precedida
    // del bloque v1491 §89 que invoca resolveClientVendorServerSide.
    const idx = src.indexOf("makeError(\n      'VENDOR_UID_MISSING'");
    expect(idx).toBeGreaterThan(0);
    const slicePre = src.slice(Math.max(0, idx - 3500), idx);
    expect(slicePre).toContain('v1491 §89');
    expect(slicePre).toMatch(/resolveClientVendorServerSide\s*\(/);
    expect(slicePre).toMatch(/vendorKeyHint:\s*payload\.vendorAssigned/);
    // Debe pisar _hasVendorUid tras resolver.
    expect(slicePre).toMatch(/_hasVendorUid = true/);
  });

  it('T22 el gate preserva el fallo si tampoco se resuelve server-side', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    // Debe haber un segundo if (_hasVendorName && !_hasVendorUid) para el reject final.
    expect(src.match(/if \(_hasVendorName && !_hasVendorUid\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/serverResolveAttempted:\s*true/);
  });
});
