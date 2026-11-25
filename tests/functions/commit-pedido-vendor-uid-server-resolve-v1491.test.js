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

/**
 * Lee el fuente del core normalizando finales de línea (CRLF → LF). En Windows,
 * con core.autocrlf=true, el checkout tiene CRLF y los asserts que buscan
 * '\n' literal fallan aunque el código sea idéntico (informe 62).
 */
async function readCoreSrc() {
  const { readFileSync } = await import('node:fs');
  return readFileSync('functions/core/commit-pedido-core.js', 'utf8').replace(/\r\n/g, '\n');
}

describe('v1491 §89 — commit-pedido-core gate llama resolver server-side', () => {
  it('T20 el import de resolveClientVendorServerSide está presente', async () => {
    const src = await readCoreSrc();
    expect(src).toMatch(
      /import \{\s*resolveClientVendorServerSide\s*\} from ['"]\.\/resolve-client-vendor-core\.js['"]/
    );
  });

  it('T21 el gate VENDOR_UID_MISSING ahora intenta resolver server-side antes de rechazar', async () => {
    const src = await readCoreSrc();
    // La llamada makeError('VENDOR_UID_MISSING', ...) debe venir precedida
    // del bloque que invoca resolveClientVendorServerSide. v1491 §89 original
    // disparaba solo si !_hasVendorUid; v1577 §Decisión-1 lo amplió a correr
    // SIEMPRE (recompute as autoritativo).
    // S-3 T4 adversarial (stack/s2-instrumentation): el reject fue envuelto
    // en `rejectWithTimer(...)` para que emita commit_phase_timers también
    // en paths de rechazo. Aceptamos ambos patrones para compat.
    let idxReject = src.indexOf("makeError(\n      'VENDOR_UID_MISSING'");
    if (idxReject < 0) {
      idxReject = src.indexOf("rejectWithTimer(\n      'VENDOR_UID_MISSING'");
    }
    expect(idxReject).toBeGreaterThan(0);
    // Debe existir la invocación resolveClientVendorServerSide ANTES del
    // reject (en cualquier lugar del archivo si tiene el tag v1577).
    const idxResolve = src.indexOf('resolveClientVendorServerSide(');
    expect(idxResolve).toBeGreaterThan(0);
    expect(idxResolve).toBeLessThan(idxReject);
    // Tags válidos: v1491 §89 (original) o v1577 §Dec (recompute siempre).
    expect(src).toMatch(/v1491 §89|v1577 §Dec/);
    expect(src).toMatch(/vendorKeyHint:\s*payload\.vendorAssigned/);
    // Debe pisar _hasVendorUid tras resolver.
    expect(src).toMatch(/_hasVendorUid = true/);
  });

  it('T22 el gate preserva el fallo si tampoco se resuelve server-side', async () => {
    const src = await readCoreSrc();
    // El reject final por VENDOR_UID_MISSING debe seguir existiendo.
    // v1577 §Decisión-1 cambió el primer guard (`if (_hasVendorName && ...)`)
    // por `if (_hasVendorName || cardCode || clientName)` (recompute siempre).
    // El segundo guard antes del reject SÍ sigue siendo el patrón original.
    expect(src.match(/if \(_hasVendorName && !_hasVendorUid\)/g)?.length).toBeGreaterThanOrEqual(1);
    expect(src).toMatch(/serverResolveAttempted:\s*true/);
  });
});
